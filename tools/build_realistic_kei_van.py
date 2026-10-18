# build_realistic_kei_van.py
# 実行コマンド: blender -b -P build_realistic_kei_van.py
import bpy
import bmesh
import math
from mathutils import Vector

# ==============================================================================
# 1. 初期化 ＆ 単位設定 (メートル・実寸: 3395 x 1475 x 1895 mm)
# ==============================================================================
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0

AXLE_F = 1.1525
AXLE_R = -1.2975
ARCH_Z = 0.275
ARCH_RAD = 0.312

# ==============================================================================
# 2. PBR 自動車マテリアル作成 (Blender 3.x / 4.x 両対応)
# ==============================================================================
def create_pbr_mat(name, base_color, metallic=0.0, roughness=0.2, coat=0.0, alpha=1.0, emission=None):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness

    # Coat / Clearcoat (Blender 4.0+ / 3.x 互換)
    for coat_key in ("Coat Weight", "Clearcoat"):
        if coat_key in bsdf.inputs:
            bsdf.inputs[coat_key].default_value = coat
    for coat_r_key in ("Coat Roughness", "Clearcoat Roughness"):
        if coat_r_key in bsdf.inputs:
            bsdf.inputs[coat_r_key].default_value = 0.03

    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        if hasattr(mat, "blend_method"):
            mat.blend_method = 'BLEND'

    if emission:
        for em_key in ("Emission Color", "Emission"):
            if em_key in bsdf.inputs:
                bsdf.inputs[em_key].default_value = (*emission, 1.0)
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = 2.5
    return mat

MAT_PAINT = create_pbr_mat("Automotive_White_Clearcoat", (0.95, 0.96, 0.97), metallic=0.06, roughness=0.16, coat=1.0)
MAT_BLACK_RESIN = create_pbr_mat("Unpainted_Resin", (0.08, 0.09, 0.11), metallic=0.05, roughness=0.58)
MAT_TIRE = create_pbr_mat("Tire_Rubber_145_80R12", (0.06, 0.065, 0.07), metallic=0.02, roughness=0.78)
MAT_STEEL_WHEEL = create_pbr_mat("Steel_Wheel_Silver", (0.76, 0.79, 0.82), metallic=0.85, roughness=0.26)
MAT_CHROME = create_pbr_mat("Chrome_Plating", (0.98, 0.98, 0.99), metallic=1.0, roughness=0.04, coat=0.5)
MAT_GLASS = create_pbr_mat("Tempered_Glass", (0.78, 0.92, 0.86), metallic=0.05, roughness=0.02, coat=1.0, alpha=0.32)
MAT_HEADLIGHT = create_pbr_mat("Headlight_LED", (1.0, 0.98, 0.9), roughness=0.1, emission=(1.0, 0.95, 0.8))
MAT_TAILLIGHT = create_pbr_mat("Taillight_Red", (0.85, 0.08, 0.08), roughness=0.12, coat=1.0, emission=(0.8, 0.05, 0.05))
MAT_AMBER = create_pbr_mat("Turn_Amber", (0.95, 0.55, 0.05), roughness=0.15, coat=1.0)
MAT_INTERIOR = create_pbr_mat("Cabin_Interior", (0.14, 0.16, 0.19), roughness=0.72)
MAT_PLATE = create_pbr_mat("Kei_Yellow_Plate", (0.95, 0.78, 0.08), roughness=0.35)

# ==============================================================================
# 3. 断面プロファイル関数 ＆ パラメトリック曲面メッシュビルダー (Blender Z-up座標系)
#    X: 前後 [-1.6975, +1.6975], Y: 左右 [-0.7375, +0.7375], Z: 高さ [0, 1.895]
# ==============================================================================
def get_half_width(z, x):
    y_base = 0.7375
    if x > 1.15:
        t = min(1.0, (x - 1.15) / 0.5475)
        y_base -= 0.048 * (t ** 1.7)
    elif x < -1.35:
        t = min(1.0, (-1.35 - x) / 0.3475)
        y_base -= 0.032 * (t ** 1.8)

    if z < 0.32:
        t = max(0.0, (0.32 - z) / 0.11)
        return y_base - 0.038 * (t * t)
    if z <= 0.96:
        c1 = math.exp(-(((z - 0.38) / 0.018) ** 2)) * 0.004
        c2 = math.exp(-(((z - 0.92) / 0.022) ** 2)) * 0.005
        return y_base + c1 + c2
    t_up = min(1.0, (z - 0.96) / (1.81 - 0.96))
    return y_base - 0.096 * (t_up ** 1.45)

def apply_wheel_arch(x, z):
    x_out, z_out, y_flare = x, z, 0.0
    for cx in (AXLE_F, AXLE_R):
        dx = x - cx
        dz = z - ARCH_Z
        dist = math.hypot(dx, dz)
        if dist < ARCH_RAD:
            ang = math.atan2(max(0.01, dz), dx)
            x_out = cx + math.cos(ang) * ARCH_RAD
            z_out = ARCH_Z + math.sin(ang) * ARCH_RAD
            y_flare = 0.013
        elif dist < ARCH_RAD + 0.055 and z > ARCH_Z - 0.03:
            rim_t = 1.0 - (dist - ARCH_RAD) / 0.055
            y_flare = max(y_flare, 0.013 * math.sin(rim_t * math.pi * 0.5))
    return x_out, z_out, y_flare

def create_parametric_mesh(name, u_steps, v_steps, eval_fn, mat, solidify_thickness=0.0):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    grid = []
    for iv in range(v_steps + 1):
        v = iv / v_steps
        row = []
        for iu in range(u_steps + 1):
            u = iu / u_steps
            co = eval_fn(u, v)
            row.append(bm.verts.new(co))
        grid.append(row)

    for iv in range(v_steps):
        for iu in range(u_steps):
            v1 = grid[iv][iu]
            v2 = grid[iv][iu + 1]
            v3 = grid[iv + 1][iu + 1]
            v4 = grid[iv + 1][iu]
            bm.faces.new((v1, v2, v3, v4))

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    for poly in mesh.polygons:
        poly.use_smooth = True

    obj.data.materials.append(mat)

    if solidify_thickness > 0.0:
        sol = obj.modifiers.new(name="PanelThickness", type='SOLIDIFY')
        sol.thickness = solidify_thickness
        sol.offset = -1.0
    return obj

# ==============================================================================
# 4. ボディパネル・ピラー・ルーフ・ガラスの構築
# ==============================================================================
for side in (-1.0, 1.0):
    tag = "R" if side > 0 else "L"
    # ロアサイドパネル（ホイールアーチ切り欠き＆ドアシャットライン付）
    def side_lower_fn(u, v, s=side):
        x = -1.66 + u * (1.42 - (-1.66))
        belt_z = 0.97
        if x > 0.52:
            t_dip = min(1.0, (x - 0.52) / 0.65)
            belt_z = 0.97 - 0.065 * math.sin(t_dip * math.pi * 0.5)
        z = 0.21 + v * (belt_z - 0.21)
        x, z, flare = apply_wheel_arch(x, z)
        y = get_half_width(z, x) + flare
        for seam_x in (1.08, 0.12, -0.82):
            d_seam = abs(x - seam_x)
            if d_seam < 0.009:
                y -= 0.0055 * (1.0 - d_seam / 0.009)
        if -1.52 <= x <= -0.80 and abs(z - 0.904) < 0.013:
            y -= 0.009
        return (x, s * y, z)

    create_parametric_mesh(f"Body_SideLower_{tag}", 96, 28, side_lower_fn, MAT_PAINT, 0.002)

    # ルーフキャントレール
    create_parametric_mesh(
        f"Body_Cantrail_{tag}", 44, 8,
        lambda u, v, s=side: (
            -1.62 + u * 2.34,
            s * get_half_width(1.71 + v * 0.10, -1.62 + u * 2.34),
            1.71 + v * 0.10
        ),
        MAT_PAINT, 0.002
    )

    # Aピラー
    def a_pillar_fn(u, v, s=side):
        z = 0.91 + v * (1.74 - 0.91)
        x_front = 1.18 - v * (1.18 - 0.70)
        x = x_front - u * 0.085
        return (x, s * get_half_width(z, x), z)
    create_parametric_mesh(f"Body_APillar_{tag}", 8, 18, a_pillar_fn, MAT_PAINT, 0.003)

    # B / C / Dピラー
    for p_name, x0, x1, mat in (
        ("BPillar", 0.06, 0.17, MAT_BLACK_RESIN),
        ("CPillar", -0.87, -0.77, MAT_BLACK_RESIN),
        ("DPillar", -1.65, -1.50, MAT_PAINT),
    ):
        def pillar_fn(u, v, x0=x0, x1=x1, s=side):
            z = 0.96 + v * (1.72 - 0.96)
            tilt = (v * 0.05) if x0 < -1.4 else 0.0
            x = x0 + tilt + u * (x1 - x0)
            return (x, s * get_half_width(z, x), z)
        create_parametric_mesh(f"Body_{p_name}_{tag}", 6, 14, pillar_fn, mat, 0.002)

    # サイドガラス3枚
    for w_name, xr, xfb, xft in (
        ("FrontDoorGlass", 0.16, 1.10, 0.68),
        ("SlideDoorGlass", -0.78, 0.07, 0.07),
        ("QuarterGlass", -1.51, -0.86, -0.86),
    ):
        def win_fn(u, v, xr=xr, xfb=xfb, xft=xft, s=side):
            z_bot = (0.97 - 0.06 * math.sin(((u - 0.45) / 0.55) * math.pi * 0.5)) if (xfb > 0.5 and u > 0.45) else 0.97
            z = z_bot + v * (1.71 - z_bot)
            xf = xfb + v * (xft - xfb)
            x = xr + u * (xf - xr)
            return (x, s * (get_half_width(z, x) - 0.008), z)
        create_parametric_mesh(f"Glass_{w_name}_{tag}", 14, 10, win_fn, MAT_GLASS)

# ハイルーフパネル（7本補強ビード付）
def roof_fn(u, v):
    x = -1.60 + u * 2.36
    s = v * 2.0 - 1.0
    y = s * get_half_width(1.80, x)
    z = 1.81 + 0.082 * (1.0 - (abs(s) ** 2.4))
    if x > 0.48:
        tf = (x - 0.48) / 0.28
        z -= 0.065 * tf * tf
    elif x < -1.42:
        tr = (-1.42 - x) / 0.18
        z -= 0.035 * tr * tr
    if -1.42 < x < 0.35 and abs(s) < 0.82:
        rib = math.cos(s * 7.0 * math.pi)
        if rib > 0.45:
            z += 0.0045 * (rib - 0.45)
    return (x, y, z)
create_parametric_mesh("Body_HighRoof", 60, 44, roof_fn, MAT_PAINT, 0.002)

# フロントウインドシールド
def windshield_fn(u, v):
    s = u * 2.0 - 1.0
    z = 1.00 + v * 0.74
    x = (1.18 - v * 0.48) + 0.048 * (1.0 - s * s)
    y = s * (get_half_width(z, x) - 0.055)
    return (x, y, z)
create_parametric_mesh("Glass_Windshield", 24, 20, windshield_fn, MAT_GLASS)

# ショートボンネット
def hood_fn(u, v):
    s = v * 2.0 - 1.0
    x = min(1.665, 1.18 + u * 0.47 + 0.042 * (1.0 - s * s))
    y = s * get_half_width(0.92, x)
    z = 1.005 - (u ** 2.2) * 0.115 + 0.024 * (1.0 - s * s)
    return (x, y, z)
create_parametric_mesh("Body_Hood", 24, 28, hood_fn, MAT_PAINT, 0.002)

# フロントバンパー
def front_bumper_fn(u, v):
    s = u * 2.0 - 1.0
    z = 0.20 + v * 0.69
    hw = get_half_width(min(z, 0.75), 1.55)
    ang = s * (math.pi * 0.48)
    x = 1.42 + math.cos(ang) * 0.2775
    y = math.sin(ang) * hw
    if 0.26 < z < 0.50 and abs(y) < 0.42:
        x -= 0.032
    return (x, y, z)
create_parametric_mesh("Body_FrontBumper", 36, 24, front_bumper_fn, MAT_PAINT, 0.002)

# バックドア＆リアガラス
def tailgate_lower_fn(u, v):
    s = u * 2.0 - 1.0
    z = 0.45 + v * 0.55
    y = s * get_half_width(z, -1.66)
    x = -1.675 - 0.018 * (1.0 - s * s)
    if 0.56 < z < 0.78 and abs(y) < 0.21:
        x += 0.026
    return (x, y, z)
create_parametric_mesh("Body_TailgateLower", 28, 18, tailgate_lower_fn, MAT_PAINT, 0.002)

def rear_glass_fn(u, v):
    s = u * 2.0 - 1.0
    z = 1.00 + v * 0.69
    y = s * (get_half_width(z, -1.64) - 0.09)
    x = -1.67 + v * 0.045 - 0.014 * (1.0 - s * s)
    return (x, y, z)
create_parametric_mesh("Glass_RearWindow", 20, 14, rear_glass_fn, MAT_GLASS)

# ==============================================================================
# 5. 12インチ「鉄チン」ホイール ＆ 145/80R12 LTタイヤ ＆ 内装・灯火類
# ==============================================================================
def add_box(name, size, loc, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0] * 0.5, size[1] * 0.5, size[2] * 0.5)
    bpy.ops.object.transform_apply(scale=True)
    bev = obj.modifiers.new(name="Bevel", type='BEVEL')
    bev.width = 0.006
    bev.segments = 2
    obj.data.materials.append(mat)
    return obj

# ヘッドライト・グリル・リアバンパー・ナンバープレート
add_box("Front_UpperGrille", (0.04, 0.78, 0.11), (1.662, 0.0, 0.78), MAT_BLACK_RESIN)
add_box("Front_LowerGrille", (0.03, 0.82, 0.23), (1.655, 0.0, 0.38), MAT_BLACK_RESIN)
add_box("Front_LicensePlate", (0.018, 0.33, 0.165), (1.688, 0.19, 0.34), MAT_PLATE)
add_box("Rear_Bumper", (0.11, 1.44, 0.23), (-1.645, 0.0, 0.33), MAT_PAINT)
add_box("Rear_LicensePlate", (0.018, 0.33, 0.165), (-1.668, 0.0, 0.66), MAT_PLATE)

for side in (-1.0, 1.0):
    tag = "R" if side > 0 else "L"
    add_box(f"Headlight_Housing_{tag}", (0.09, 0.23, 0.21), (1.615, side * 0.545, 0.77), MAT_HEADLIGHT, (0, 0, -side * 0.22))
    add_box(f"TailLamp_Red_{tag}", (0.03, 0.18, 0.085), (-1.695, side * 0.52, 0.33), MAT_TAILLIGHT)
    add_box(f"SideMirror_{tag}", (0.08, 0.15, 0.21), (0.94, side * 0.81, 1.08), MAT_BLACK_RESIN)

# 内装（フロア・ダッシュボード・フロントシート2脚・リアベンチシート）
add_box("Interior_Floor", (2.85, 1.32, 0.04), (-0.18, 0.0, 0.26), MAT_INTERIOR)
add_box("Interior_Dashboard", (0.38, 1.30, 0.42), (1.02, 0.0, 0.76), MAT_INTERIOR)
for side in (-1.0, 1.0):
    tag = "R" if side > 0 else "L"
    add_box(f"Seat_FrontCushion_{tag}", (0.46, 0.46, 0.12), (0.38, side * 0.33, 0.52), MAT_INTERIOR)
    add_box(f"Seat_FrontBack_{tag}", (0.11, 0.44, 0.58), (0.20, side * 0.33, 0.83), MAT_INTERIOR, (0, -0.14, 0))
add_box("Seat_RearBench", (0.42, 1.18, 0.11), (-0.48, 0.0, 0.48), MAT_INTERIOR)
add_box("Seat_RearBack", (0.09, 1.18, 0.48), (-0.66, 0.0, 0.74), MAT_INTERIOR, (0, -0.12, 0))

# 4輪タイヤ＆12インチスチールホイール生成
for w_name, wx, wy in (
    ("Wheel_FR", AXLE_F, 0.655),
    ("Wheel_FL", AXLE_F, -0.655),
    ("Wheel_RR", AXLE_R, 0.655),
    ("Wheel_RL", AXLE_R, -0.655),
):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.205, minor_radius=0.066,
        major_segments=48, minor_segments=24,
        location=(wx, wy, 0.271), rotation=(math.pi / 2, 0, 0)
    )
    tire = bpy.context.active_object
    tire.name = f"{w_name}_Tire"
    tire.data.materials.append(MAT_TIRE)

    bpy.ops.mesh.primitive_cylinder_add(
        radius=0.152, depth=0.11, vertices=36,
        location=(wx, wy, 0.271), rotation=(math.pi / 2, 0, 0)
    )
    rim = bpy.context.active_object
    rim.name = f"{w_name}_SteelRim"
    rim.data.materials.append(MAT_STEEL_WHEEL)

# ==============================================================================
# 6. ファイル保存 (.blend ＆ .glb)
# ==============================================================================
bpy.ops.wm.save_as_mainfile(filepath="kei_van_realistic.blend")
bpy.ops.export_scene.gltf(filepath="kei_van_realistic.glb", export_format='GLB')
print("SUCCESS: Saved kei_van_realistic.blend and kei_van_realistic.glb")
