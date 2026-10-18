# 車両管理

配送会社向けの、車両台帳と整備記録を管理する Web アプリ(PWA)です。
サーバー不要で、ブラウザだけで動きます。データは今のところブラウザ内(localStorage)に保存します。

## できること

- **ダッシュボード**: 車両数、要対応・注意のアラート件数、今月の整備費。車検・自賠責・任意保険・次回整備の期限を近い順に一覧
- **車両台帳**: 管理番号・ナンバー・車種・拠点・ステータス・各期限・走行距離を一覧。検索、拠点/ステータスで絞り込み、列で並び替え、CSV 書き出し
- **車両詳細**: 期限タイル、**車体の図(上面図)で部位ごとの異常を表示**、車両情報、次回整備の目安、整備履歴、整備費の集計
- **異常の記録**: 部位(前バンパー・エンジン・各タイヤ・側面・荷室…)と緊急度(至急/早めに/様子見)を付けて登録。異常のある部位は図の上で色が付き脈打つ。部位をクリックすると絞り込み。対応済みにすると消える
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
issue   = { id, vehicleId, part, severity: 'high'|'mid'|'low', title, detail,
            reportedAt, status: 'open'|'fixed', fixedAt, createdAt, updatedAt }
settings = { alertDays, warnDays, odometerWarnKm, bases: [], types: [], companyName }
```

## 今後

- Supabase に保存先を切り替え、複数人・複数端末で共有(ログイン、拠点ごとの権限)
- GitHub Pages で公開
- ドライバー用のスマホ入力(日常点検、給油、走行距離)
- 車検証・保険証券の画像添付、書類の期限リマインド通知
