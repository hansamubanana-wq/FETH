# みんなで競馬

ブラウザで遊べる競馬ベットゲームです。ローカル対戦と Firebase Firestore を使ったオンライン対戦に対応し、Three.js の3Dレース場と外部GLB馬モデルでレースを再生します。

![ダーク×ゴールドの夜間競馬場を使ったホーム画面](assets/art/bg-home.png)

## 主な機能

- 8頭立てのレースシミュレーション
- 実力を中心に、調子・展開・スタミナ配分で僅差の番狂わせが起こる決定論的レースモデル
- 単勝、複勝、馬連、馬単、ワイド、3連複、3連単のベット
- ローカル複数人プレイ
- Firebase Firestore を使ったオンライン部屋作成・参加
- 一緒に遊んだ人のフレンド化と招待
- 初回入力したプレイヤー名の保存
- 画面ごとにクロスフェードする全画面競馬場背景とガラス調UI
- 8頭それぞれの馬肖像、表彰台形式の結果表示、数字カウントアップ
- 3Dレース場、8種の毛色、走行時の砂埃・芝飛沫、観客フラッシュ、優勝馬スポットライト
- レースごとに決定論的に選ばれる昼・夕方・夜の3D競馬場（星空とナイター照明）
- リアルタイム順位ビジョン、開閉スタートゲート、3着までのゴール速報
- 肖像アートとパララックス背景を使った横スクロール式2Dフォールバック
- 金縁アバターカードを備えたオンライン作成・参加・待機画面
- GPT Image 2製の勝利キーアートと優勝馬肖像を合成した結果演出
- 馬カードを起点に、賭け式・残りの馬・賭け金へ進む一本道のベットフロー
- 選択中のパンくず表示、順序バッジ、戻る・キャンセル、購入済み馬券の取消
- 勝利キーアートと表彰台を分離した見やすい結果レイアウト
- 初回スプラッシュと3Dモデル読み込みプログレス
- レース中の順位、損益、特殊能力ログ表示
- 破産中プレイヤーの単勝復活チャレンジ
- サーバー保存済み馬名の共有・追加・削除
- スマホ、タブレット、PC向けレスポンシブ表示
- favicon、アプリアイコン、OGP画像付き

## 使用技術

- HTML
- CSS
- JavaScript
- Three.js
- GLTFLoader
- Firebase Firestore

## 起動方法

```bash
python -m http.server 5173
```

Windowsで `python` が Microsoft Store のエイリアスを指す場合は、代わりに次を使います。

```bash
py -m http.server 5173
```

ブラウザで `http://localhost:5173/` を開いてください。

オンライン対戦を使う場合は、`src/firebase-config.js` に Firebase 設定を入れます。

## ディレクトリ構成

```text
.
├── assets/
│   └── art/
│       ├── bg-home.png
│       ├── bg-paddock.png
│       ├── bg-stadium.png
│       ├── favicon.svg
│       ├── horses/
│       │   └── horse1.png ... horse8.png
│       ├── icon-192.png
│       ├── icon-512.png
│       ├── logo.png
│       ├── ogp.png
│       └── victory.png
├── src/
│   ├── betui.js
│   ├── engine.js
│   ├── local.js
│   ├── online.js
│   ├── race.js
│   ├── race-sim.js
│   ├── race3d.js
│   ├── raceui.js
│   └── ...
├── firestore.rules
├── index.html
├── manifest.webmanifest
├── scripts/
│   └── monte-carlo-balance.mjs
├── style.css
└── README.md
```

レースバランスの5,000レース検証は次のコマンドで再実行できます。

```bash
node scripts/monte-carlo-balance.mjs
```

## 今後の改善案

- Firestore 更新を transaction 化してオンライン同時操作により強くする
- フレンド情報をサーバー側にも保存して別端末でも引き継ぐ
- 馬名削除の取り消し機能を追加する
- スマホ画面でのオンライン複数人プレイをさらに検証する
- Service Worker を追加してオフラインでも遊べるPWAにする
