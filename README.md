# みんなで競馬

ブラウザで遊べる競馬ベットゲームです。ローカル対戦と Firebase Firestore を使ったオンライン対戦に対応し、Three.js の3Dレース場と外部GLB馬モデルでレースを再生します。

![ダーク×ゴールドの夜間競馬場を使ったホーム画面](assets/art/home-hero.png)

## 主な機能

- 8頭立てのレースシミュレーション
- 単勝、複勝、馬連、馬単、ワイド、3連複、3連単のベット
- ローカル複数人プレイ
- Firebase Firestore を使ったオンライン部屋作成・参加
- 一緒に遊んだ人のフレンド化と招待
- 初回入力したプレイヤー名の保存
- ダーク×ゴールドのホーム画面、装飾UI、レスポンシブ表示
- 3Dレース場、外部馬モデル、プロシージャル芝・ダート、動く雲・旗、ゴール演出
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
│       ├── favicon.svg
│       ├── home-hero.png
│       ├── icon-192.png
│       ├── icon-512.png
│       ├── logo.png
│       └── ogp.png
├── src/
│   ├── betui.js
│   ├── engine.js
│   ├── local.js
│   ├── online.js
│   ├── race.js
│   ├── race3d.js
│   ├── raceui.js
│   └── ...
├── firestore.rules
├── index.html
├── manifest.webmanifest
├── style.css
└── README.md
```

## 今後の改善案

- Firestore 更新を transaction 化してオンライン同時操作により強くする
- フレンド情報をサーバー側にも保存して別端末でも引き継ぐ
- 馬名削除の取り消し機能を追加する
- スマホ画面でのオンライン複数人プレイをさらに検証する
- Service Worker を追加してオフラインでも遊べるPWAにする
