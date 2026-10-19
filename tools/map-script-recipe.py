"""Build the patch recipe that lets scaled map windows keep their markers in place.

mbc\\st_map.mbc positions the player, mission and user marks on the minimap and bigmap windows
in original window pixels. The patch keeps all script arithmetic in those pixels and converts
only at the window boundary:

* a new global float SCALE is set right after window.open("minimap") / window.open("bigmap");
* click coordinates from window.poll_event and the map position from window.position are
  divided by SCALE;
* every window.send_message(control, 116 /* set position */, x, y, 0) multiplies x and y by SCALE.

The two SCALE immediates are the recipe parameters, so the editor can rebuild the script for any
window scale. Usage (needs the MBC decompiler from C:\\Tools\\MBCdecompiler):

    python tools/map-script-recipe.py <decompiler dir> map-recipe.mjs <st_map.mbc versions...>
"""

import difflib
import hashlib
import json
import os
import struct
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1])
from compile.lossless_ir import script_to_lossless_ir  # noqa: E402
from compile.writer import emit_mbc_image  # noqa: E402
from mbc_format.loader import MbcLoader  # noqa: E402

def build(path):
    source = Path(path).read_bytes()
    ir = script_to_lossless_ir(MbcLoader.load(path))
    rows = sorted(ir["instructions"], key=lambda r: r["offset"])
    index = {r["offset"]: i for i, r in enumerate(rows)}
    data = bytearray.fromhex(ir["data_hex"])
    data += b"\0" * (-len(data) % 4)
    scale_offset = len(data)
    data += struct.pack("<f", 1.0)


    def raw(r):
        return bytes.fromhex(r["raw_hex"])


    def push_ref(offset, float_type=False):
        return bytes([0x69, 0x20 if float_type else 0x10]) + struct.pack("<I", offset)


    SCALE = push_ref(scale_offset, True)
    inserts = {}  # original offset -> [(bytes, parameter name or None)] placed before it


    def insert(offset, code, param=None):
        inserts.setdefault(offset, []).append((code, param))


    def statement_after(offset):
        """First stack_frame_reset after offset: the start of the next statement."""
        i = index[offset] + 1
        while rows[i]["mnemonic"] != "stack_frame_reset":
            i += 1
        return rows[i]["offset"]


    def divide(var):
        # var = to_int(float(var) / SCALE)
        return b"\x30" + push_ref(var) + push_ref(var) + SCALE + b"\x3a\x2f\x60\x3d"


    def find_calls(subop):
        """window_api calls by sub-operation number: (index of that number's push, index of the call).
        In an assignment the target variable is pushed before the sub-operation."""
        found = []
        for i, r in enumerate(rows):
            if r["mnemonic"] != "window_api":
                continue
            j = i - 1
            while rows[j]["mnemonic"] != "stack_frame_reset":
                j -= 1
            k = j + 2 if rows[j + 1]["mnemonic"] == "push_data_ref" else j + 1
            first = rows[k]
            if first["mnemonic"] == "push_imm_i8" and first["operands"]["value"] == subop:
                found.append((k, i))
        return found


    # window.open("minimap"/"bigmap") stores the handle; set SCALE in the next statement.
    for start, end in find_calls(20):
        span = rows[start + 1]["operands"]
        name = data[span["data_offset"] : span["data_offset"] + span["length"]].split(b"\0")[0]
        if name in (b"minimap", b"bigmap"):
            at = statement_after(rows[end]["offset"])
            # SCALE = <window scale>; the float immediate is the recipe parameter
            insert(at, b"\x30" + SCALE + b"\x39\x20" + struct.pack("<f", 1.0) + b"\x3d", name.decode())

    # window.poll_event(..., &x, &y): normalise click coordinates where the event is handled.
    for start, end in find_calls(22):
        jump = rows[end + 2]
        assert jump["mnemonic"] == "jfalse_rel16", jump
        at = jump["operands"]["target"]
        insert(at, divide(0x1700) + divide(0x1704))

    # window.position(map, &x, &y)
    for start, end in find_calls(33):
        at = statement_after(rows[end]["offset"])
        insert(at, divide(0x1620) + divide(0x1624))

    # window.send_message(control, 116, x, y, 0): scale both coordinates.
    EFFECT = {
        "push_data_ref": 1,
        "push_imm_i8": 1,
        "push_imm_u16": 1,
        "push_imm32": 1,
        "sub": -1,
        "add": -1,
        "mul": -1,
        "div": -1,
        "to_float": 0,
        "to_float_prev": 0,
        "to_int": 0,
        "array_index_abs": 0,
    }


    def kind(r, stack):
        m = r["mnemonic"]
        t = r["operands"].get("type_name", "")
        if m in ("push_data_ref", "push_imm_i8", "push_imm_u16", "push_imm32"):
            stack.append("float" if t == "float32" else "int")
        elif m in ("sub", "add", "mul", "div"):
            b, a = stack.pop(), stack.pop()
            stack.append("float" if "float" in (a, b) else "int")
        elif m == "to_float":
            stack[-1] = "float"
        elif m == "to_float_prev":
            stack[-2] = "float"
        elif m == "to_int":
            stack[-1] = "int"
        elif m == "array_index_abs":
            stack[-1] = "int"
        else:
            raise ValueError(f"unexpected {m} at 0x{r['offset']:X}")


    for start, end in find_calls(25):
        # The control may be a plain variable or an array element (push index, array_index_abs).
        message = start + (3 if rows[start + 2]["mnemonic"] == "array_index_abs" else 2)
        if not (rows[message]["mnemonic"] == "push_imm_i8" and rows[message]["operands"]["value"] == 116):
            continue
        stack = []
        marks = []
        for i in range(message + 1, end - 2):  # up to the trailing push 0, set_arg_count, call
            kind(rows[i], stack)
            if len(stack) == 1 and not marks:
                # x ends here when the remaining instructions form exactly one expression (y)
                probe = []
                try:
                    for k in range(i + 1, end - 2):
                        kind(rows[k], probe)
                    if len(probe) == 1:
                        marks.append((rows[i + 1]["offset"], stack[-1]))
                except (IndexError, ValueError):
                    pass
        assert len(marks) == 1 and len(stack) == 2, hex(rows[start]["offset"])
        tail = rows[end - 2]["offset"]
        for offset, t in (marks[0], (tail, stack[-1])):
            insert(offset, SCALE + (b"\x2a" if t == "float" else b"\x3a\x2a") + b"\x60")

    # Relocate: new offsets, branch operands, program and function tables.
    new_offset = {}
    pos = 0
    for r in rows:
        new_offset[r["offset"]] = pos + sum(len(c) for c, _ in inserts.get(r["offset"], []))
        pos = new_offset[r["offset"]] + r["length"]
    code_end = pos
    new_offset[len(bytes.fromhex(ir["code_hex"]))] = code_end
    inserted_at = {o: new_offset[o] - sum(len(c) for c, _ in inserts[o]) for o in inserts}


    def target(old):
        # Jumps into an insertion point run the inserted code first.
        return inserted_at.get(old, new_offset[old])


    code = bytearray()
    param_slots = {}
    for r in rows:
        for c, param in inserts.get(r["offset"], []):
            if param:
                param_slots[param] = len(code) + 1 + len(SCALE) + 2
            code += c
        b = bytearray(raw(r))
        ops = r["operands"]
        if "rel" in ops and "target" in ops:
            width = 4 if r["mnemonic"] == "call_rel32" else 2
            rel = target(ops["target"]) - (len(code) + 1)
            b[1 : 1 + width] = rel.to_bytes(width, "little", signed=True)
        code += b
    assert len(code) == code_end, (len(code), code_end)


    programs = []
    for p in ir["programs"]:
        q = dict(p)
        q["start"] = target(p["start"])
        q["end"] = target(p["end"] + 1) - 1
        programs.append(q)
    functions = []
    for f in ir["functions"]:
        g = dict(f)
        g["code_offset"] = target(f["code_offset"])
        functions.append(g)

    header = ir["header"]
    image = emit_mbc_image(
        checksum_or_tag=header["checksum_or_tag"],
        module_tag=header["module_tag"],
        code=code,
        data=data,
        programs=programs,
        functions=functions,
        metadata=bytes.fromhex(ir["metadata_hex"]),
    )
    HEADER = 0x20
    # The recipe copies unchanged runs from the player's own script. Replaced runs keep both sides
    # (relocated jump operands and the inserted code) so an already patched script can be rebuilt.
    ops = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, source, image, autojunk=False).get_opcodes():
        if tag == "equal":
            ops.append([i1, i2 - i1])
        else:
            ops.append({"from": source[i1:i2].hex(), "to": image[j1:j2].hex()})
    recipe = {
        "script": "st_map.mbc",
        "sourceSha256": hashlib.sha256(source).hexdigest(),
        "resultSize": len(image),
        "params": {w: HEADER + o for w, o in param_slots.items()},
        "ops": ops,
    }
    return recipe, image


recipes, images = [], []
for path in sys.argv[3:]:
    recipe, image = build(path)
    if all(r["sourceSha256"] != recipe["sourceSha256"] for r in recipes):
        recipes.append(recipe)
        images.append((path, recipe, image))
    print(path, "params", recipe["params"], "ops", len(recipe["ops"]))
Path(sys.argv[2]).write_text(
    "// Generated by tools/map-script-recipe.py: scale-aware markers for mbc\\st_map.mbc.\n"
    "export default " + json.dumps(recipes, separators=(",", ":")) + ";\n"
)
# MAP_TEST_SCALES="1.75 1.5" writes <sha prefix>.mbc into MAP_TEST_OUT for in-game tests.
if os.environ.get("MAP_TEST_SCALES"):
    minimap, bigmap = map(float, os.environ["MAP_TEST_SCALES"].split())
    for path, recipe, image in images:
        out = bytearray(image)
        for window, value in (("minimap", minimap), ("bigmap", bigmap)):
            o = recipe["params"][window]
            out[o : o + 4] = struct.pack("<f", value)
        Path(os.environ.get("MAP_TEST_OUT", ".")).joinpath(recipe["sourceSha256"][:8] + ".mbc").write_bytes(out)
