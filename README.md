# 車両管理

配送会社向けの、車両台帳と整備記録を管理する Web アプリ(PWA)です。
サーバー不要で、ブラウザだけで動きます。データは今のところブラウザ内(localStorage)に保存します。

## できること

- **ダッシュボード**: 車両数、要対応・注意のアラート件数、今月の整備費。車検・自賠責・任意保険・次回整備の期限を近い順に一覧
- **車両台帳**: **駐車場ビュー**(拠点ごとの駐車区画に軽バンが並び、状態の色・異常件数・期限アラートが乗る)と一覧表を切り替え。検索、拠点/ステータスで絞り込み、列で並び替え、CSV 書き出し
- **車両詳細**: 期限タイル、**軽バンの 5 面図(図面画像そのまま。左側面・右側面・上面・正面・背面)**で部位ごとの異常を表示(赤 = 未対応の異常、青枠 = 選択中。面ごとに異常件数)、車両情報、次回整備の目安、整備履歴、整備費の集計
- **異常の記録**: 場所(ランプ・タイヤ・ミラー・スライドドア・バンパー…)→ 左右前後 → 図の上をクリックしてピン、の順に選んで登録。緊急度(至急/早めに/様子見)付き。**写真を添付できる**(縮小して IndexedDB に保存、タップで拡大)。異常のある部位は図の上で赤く表示、ピンを打った異常は番号付きのピンでその位置に表示。部位をクリックすると絞り込み。対応済みにすると消える
- **整備記録にも写真**を添付できる。バックアップ JSON には写真も含まれる
- **整備記録**: いつ・何を・どこで・いくらで・何 km のときに。次回の目安(日付 or 距離)を入れるとアラートに出る。「車検」の記録からは車検満了日を台帳に反映できる
- **設定**: アラート基準(日数・距離)、拠点、整備種別、JSON バックアップ/復元、サンプルデータ、全削除

## 使い方

ローカルで開く(ES modules を使うので `file://` ではなく HTTP サーバーで):

```sh
cd fleet-manager
python3 -m http.server 8080
# → http://localhost:8080
```

最初は空なので、設定 →「サンプルデータを入れる」で 24 台分のデータを入れると全画面を試せます。

## 構成

```
index.html            画面の骨組みとナビ
css/style.css         見た目(PC 優先、スマホは下タブ)
js/logic.js           期限判定・集計・検証・CSV などの純粋関数(テスト対象)
js/store.js           保存層。いまは localStorage。将来 Supabase に差し替える想定
js/sample.js          固定シードのサンプルデータ
js/views2d.js         車体の 5 面図(img/ の図面画像 + 透明な部位の領域)
js/regions2d.js       部位の領域(画像ピクセル座標)
img/                  図面画像(reference/ から切り出し)
js/photos.js          写真の縮小と IndexedDB 保存。起動時に読み込み、url(id) で参照
js/app.js             画面の描画とイベント(ハッシュルーティング、<dialog> フォーム)
sw.js                 オフライン用の最小キャッシュ
tests/logic.test.mjs  node --test
```

## テスト

```sh
node --test tests/*.test.mjs
```

## データ構造

```js
vehicle = { id, code, name, plate, maker, model, modelCode, vin, firstRegistration,
            status: 'active'|'repair'|'idle'|'retired', base, driver,
            inspectionExpiry, jibaisekiExpiry, insuranceExpiry, insuranceCompany,
            odometer, odometerDate, note, createdAt, updatedAt }
record  = { id, vehicleId, date, type, title, detail, vendor, cost, odometer,
            nextDate, nextOdometer, note, createdAt, updatedAt }
issue   = { id, vehicleId, part, severity: 'high'|'mid'|'low', title, detail, photos: [photoId],
            reportedAt, status: 'open'|'fixed', fixedAt, createdAt, updatedAt }
// record にも photos: [photoId]。写真本体は IndexedDB(fleet-photos)に Blob で保存
settings = { alertDays, warnDays, odometerWarnKm, bases: [], types: [], companyName }
```

## 今後

- Supabase に保存先を切り替え、複数人・複数端末で共有(ログイン、拠点ごとの権限)
- GitHub Pages で公開
- ドライバー用のスマホ入力(日常点検、給油、走行距離)
- 車検証・保険証券の画像添付、書類の期限リマインド通知
