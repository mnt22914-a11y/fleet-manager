# 車両管理

配送会社向けの、車両台帳と整備記録を管理する Web アプリ(PWA)です。
サーバー不要で、ブラウザだけで動きます。データは今のところブラウザ内(localStorage)に保存します。

## できること

- **ダッシュボード**: 車両数、要対応・注意のアラート件数、今月の整備費。車検・自賠責・任意保険・次回整備の期限を近い順に一覧
- **車両台帳**: **駐車場ビュー**(チームごとの駐車区画に軽バンが並び、状態の色・異常件数・期限アラート・代車使用中が乗る)と一覧表を切り替え。検索、チーム/ステータスで絞り込み、列で並び替え、CSV 書き出し
- **車両詳細**: 期限タイル、**軽バンの 5 面図(図面画像そのまま。左側面・右側面・上面・正面・背面)**で部位ごとの異常を表示(赤 = 未対応の異常、青枠 = 選択中。面ごとに異常件数)、車両情報、次回整備の目安、整備履歴、整備費の集計
- **異常の記録**: 場所(ランプ・タイヤ・ミラー・スライドドア・バンパー…)→ 左右前後 → 図の上をクリックしてピン、の順に選んで登録。緊急度(至急/早めに/様子見)付き。**写真を添付できる**(縮小して IndexedDB に保存、タップで拡大)。異常のある部位は図の上で赤く表示、ピンを打った異常は番号付きのピンでその位置に表示。部位をクリックすると絞り込み。対応済みにすると消える
- **整備記録にも写真**を添付できる。バックアップ JSON には写真も含まれる
- **整備記録**: いつ・何を・どこで・いくらで・何 km のときに。次回の目安(日付 or 距離)を入れるとアラートに出る。「車検」の記録からは車検満了日を台帳に反映できる
- **代車**: 修理中の車両に代車を登録(自社代車 = 管理車両から選ぶ / 借代車 = ナンバーだけ)。詳細と駐車場に「代車使用中」を表示し、貸した側にも「○○の代車として貸出中」を表示。「代車を返却して稼働に戻す」で元に戻る
- **事故記録**: 異常の登録で「事故記録として残す」にチェックすると、事故の状況(日時・場所・形態・管轄警察署)、自分の情報(運転手・ナンバー・損傷)、相手の情報(氏名・電話・ナンバー・損傷)と写真を記録。傷の場所は図に複数ピン。修理済み/未修理を管理し、車両詳細の「事故記録」カードに保険用の一覧として残る
- **車両の CSV 一括登録**: テンプレート CSV を Excel で埋めて読み込む。登録前に一覧と行ごとの問題点を表示。同じナンバーは上書き(空欄の項目は残す)。Excel 風の日付(2027/3/31、R9.3.31)も読める
- **バックアップの催促**: 7 日以上書き出していないとダッシュボードに黄色のバナーが出る。設定に最終バックアップ日を表示
- **設定**: アラート基準(日数・距離)、チーム、整備種別、JSON バックアップ/復元、CSV 書き出し/一括登録、サンプルデータ、全削除

## 使い方

`起動.command` をダブルクリックすると、簡易サーバーを起動して Chrome で開きます。手で開くなら(ES modules を使うので `file://` ではなく HTTP サーバーで):

```sh
cd fleet-manager
python3 -m http.server 8080
# → http://localhost:8080
```

最初は空なので、設定 →「サンプルデータを入れる」で 24 台分のデータを入れると全画面を試せます。実運用の手順(初期設定、CSV での一括登録、日々の入力、週 1 回のバックアップ)は docs/運用手順.md にあります。

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
起動.command          ダブルクリックでサーバー起動 + ブラウザで開く
docs/運用手順.md      個人運用の手順
```

## テスト

```sh
node --test tests/*.test.mjs
```

## データ構造

```js
vehicle = { id, driverName, plate, qr, maker, modelCode, firstRegistration,
            status: 'active'|'repair'|'idle'|'retired', base(チーム),
            loaner: null | { type: 'own'|'rental', since, vehicleId, plate, note },
            inspectionExpiry, jibaisekiExpiry, insuranceExpiry, insuranceCompany, insurancePhone,
            odometer, odometerDate, note, createdAt, updatedAt }
record  = { id, vehicleId, date, type, title, detail, vendor, cost, odometer,
            nextDate, nextOdometer, note, createdAt, updatedAt }
issue   = { id, vehicleId, part, severity: 'high'|'mid'|'low', title, detail, photos: [photoId],
            pins: [{ view, x, y }], reportedAt(発生日), status: 'open'|'fixed', fixedAt,
            accident: null | { datetime, place, type, police, driverName, plate, ownDamage,
                               otherName, otherPhone, otherPlate, otherDamage },
            createdAt, updatedAt }
// record にも photos: [photoId]。写真本体は IndexedDB(fleet-photos)に Blob で保存
settings = { alertDays, warnDays, odometerWarnKm, bases: [], types: [], companyName, lastBackupAt }
```

## 今後

- Supabase に保存先を切り替え、複数人・複数端末で共有(ログイン、拠点ごとの権限)
- GitHub Pages で公開
- ドライバー用のスマホ入力(日常点検、給油、走行距離)
- 車検証・保険証券の画像添付、書類の期限リマインド通知
