# 実車の 3D モデルを使う

このフォルダに `van.glb` を置くと、車両詳細の 3D 表示が手作りモデルからその GLB に切り替わります(ファイルがなければ手作りモデルのまま)。

- 形式: glTF Binary(.glb)。テクスチャ埋め込み推奨。目安 20MB 以下
- 向きと大きさは自動で合わせます(長手方向を前後に、全長 3.395m、床を地面に)。合わなければ `van.json` で指定:

```json
{ "rotationY": 90, "front": "-z", "scale": 1.0 }
```

- `rotationY`: 読み込み後に Y 軸で回す角度(度)。`front`: モデルの前がどちらを向くか(`+z` か `-z`)。`scale`: 自動スケールにかける倍率
- 異常のある部位と選択中の部位は、部位ごとに決めた範囲(js/van3d.js の REGIONS)を赤い半透明の箱と縁取りで示します

## 入手先の例

- Sketchfab で「Suzuki Every」「kei van」「軽バン」を Downloadable + CC ライセンスで検索(ログインが必要。CC-BY は作者表記が必要)
- Higgsfield の image→3D(Meshy / Tripo)で reference/ の三面図から生成(クレジットが必要)

入手したモデルのライセンス(作者・URL・ライセンス名)をこのファイルに書き残してください。
