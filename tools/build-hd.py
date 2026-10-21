import argparse, concurrent.futures, gzip, hashlib, json, os, struct, subprocess, threading
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt

parser=argparse.ArgumentParser()
parser.add_argument('--jobs',default='.run/hd-work/jobs.json')
parser.add_argument('--tool',required=True)
parser.add_argument('--work',default='.run/hd-work')
parser.add_argument('--output',default='hd')
parser.add_argument('--workers',type=int,default=2)
parser.add_argument('--gpu',default='0')
args=parser.parse_args()
work=Path(args.work).resolve(); output=Path(args.output).resolve(); tool=Path(args.tool).resolve()
output.mkdir(parents=True,exist_ok=True)
for sub in ['inputs','raw','ready','logs']:(work/sub).mkdir(parents=True,exist_ok=True)
jobs=json.loads(Path(args.jobs).read_text(encoding='utf-8'))
groups={}
for job in jobs:groups.setdefault((job['sourceSha256'],job['kind']),[]).append(job)
lock=threading.Lock(); results=[]; errors=[]
sha=lambda b:hashlib.sha256(b).hexdigest()

def dds(image):
    width,height=image.size
    header=bytearray(128);header[:4]=b'DDS '
    for offset,value in [(4,124),(8,0x100f),(12,height),(16,width),(20,width*4),(76,32),(80,0x41),(88,32),(92,0xff0000),(96,0xff00),(100,0xff),(104,0xff000000),(108,0x1000)]:
        struct.pack_into('<I',header,offset,value)
    return bytes(header)+image.tobytes('raw','BGRA')

def glyph_rects(job,size):
    data=Path(job['sfn']).read_bytes();at=4
    for _ in range(2):at=data.index(0,at)+1
    rects=[]
    for glyph in range(224):
        uv=struct.unpack_from('<4f',data,at+8+glyph*28+12)
        rect=tuple(round(v*size[i%2]) for i,v in enumerate(uv))
        x,y,r,b=rect
        if 0<=x<r<=size[0] and 0<=y<b<=size[1] and rect not in rects:rects.append(rect)
    return rects

def process(group):
    job=group[0];name=job['name'];key=job['sourceSha256']+'-'+job['kind']
    original=Image.open(job['png']).convert('RGBA');pixels=np.asarray(original)
    size=(original.width*4,original.height*4)
    input_file=work/'inputs'/(key+'.png');raw_file=work/'raw'/(key+'.png')
    if job['kind']=='font':
        rgb=Image.merge('RGB',(original.getchannel('A'),)*3)
        model='realesrgan-x4plus-anime'
    else:
        # Hidden RGB must not introduce gray/white fringes into visible texels.
        data=pixels[:,:,:3].copy();empty=pixels[:,:,3]==0
        if empty.any() and not empty.all():
            indices=distance_transform_edt(empty,return_distances=False,return_indices=True)
            data[empty]=data[indices[0][empty],indices[1][empty]]
        rgb=Image.fromarray(data,'RGB');model='realesrgan-x4plus'
    rgb.save(input_file)
    if not raw_file.exists():
        command=[str(tool),'-i',str(input_file),'-o',str(raw_file),'-n',model,'-m',str(tool.parent/'models'),'-s','4','-t','256','-g',args.gpu,'-j','1:1:1']
        with (work/'logs'/(key+'.log')).open('wb') as log:
            subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,check=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    generated=Image.open(raw_file).convert('RGB')
    if generated.size!=size:raise RuntimeError('Wrong output size: '+name)
    alpha=original.getchannel('A').resize(size,Image.Resampling.LANCZOS)
    fallback_glyphs=0;glyphs=0
    if job['kind']=='font':
        generated_alpha=np.asarray(generated.convert('L')).copy()
        generated_alpha=np.minimum(generated_alpha,int(pixels[:,:,3].max()))
        alpha_image=Image.fromarray(generated_alpha,'L')
        source_alpha=np.asarray(original.getchannel('A')); fallback=np.asarray(alpha)
        constrained=np.zeros(generated_alpha.shape,dtype=np.uint8)
        for x,y,r,b in glyph_rects(job,original.size):
            glyphs+=1;box=(x*4,y*4,r*4,b*4)
            reduced=np.asarray(alpha_image.crop(box).resize((r-x,b-y),Image.Resampling.BOX))
            source=source_alpha[y:b,x:r]>=120;candidate=reduced>=120
            union=source|candidate;intersection=source&candidate
            iou=float(intersection.sum()/union.sum()) if union.any() else 1
            if iou<.95:
                fallback_glyphs+=1
                constrained[y*4:b*4,x*4:r*4]=fallback[y*4:b*4,x*4:r*4]
            else:constrained[y*4:b*4,x*4:r*4]=generated_alpha[y*4:b*4,x*4:r*4]
        alpha=Image.fromarray(constrained,'L')
        generated=original.convert('RGB').resize(size,Image.Resampling.NEAREST)
    generated.putalpha(alpha)
    ready=work/'ready'/(name+'.png');generated.save(ready)
    data=dds(generated);digest=sha(data);compressed=gzip.compress(data,compresslevel=9,mtime=0)
    filename=digest+'.dds.gz';(output/filename).write_bytes(compressed)
    # UI alpha is derived solely from the original, not predicted by the model.
    if job['kind']=='ui':
        assert generated.getchannel('A').tobytes()==original.getchannel('A').resize(size,Image.Resampling.LANCZOS).tobytes()
    result={'sourceSha256':job['sourceSha256'],'sourceSize':list(original.size),'size':list(size),'scale':4,'kind':job['kind'],'names':[j['name'] for j in group],
            'sha256':digest,'file':filename,'bytes':len(data),'compressedBytes':len(compressed),'compressedSha256':sha(compressed),'model':model,
            'alpha':'original-lanczos' if job['kind']=='ui' else 'glyph-constrained-superresolution',
            'glyphs':glyphs,'fallbackGlyphs':fallback_glyphs}
    with lock:
        results.append(result)
        (work/'progress.json').write_text(json.dumps({'done':len(results),'total':len(groups),'errors':errors},indent=2),encoding='utf-8')
        print(json.dumps({'done':len(results),'total':len(groups),'name':name,'size':size,'glyphFallbacks':fallback_glyphs}),flush=True)
    return result

with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
    futures={executor.submit(process,g):g[0]['name'] for g in groups.values()}
    for future in concurrent.futures.as_completed(futures):
        try:future.result()
        except Exception as error:
            errors.append({'name':futures[future],'error':str(error)})
            print(json.dumps(errors[-1]),flush=True)
if errors:raise RuntimeError(json.dumps(errors))
manifest={'version':1,'scale':4,'method':'Real-ESRGAN; source-derived alpha and fixed native coordinates','entries':sorted(results,key=lambda e:e['sourceSha256'])}
(output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'complete':True,'entries':len(results),'names':sum(len(r['names']) for r in results),'compressedBytes':sum(r['compressedBytes'] for r in results)}),flush=True)
