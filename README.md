# みんなで競馬

ローカル対戦とオンライン対戦に対応した、ブラウザで遊べる競馬ベットゲームです。レース画面は Three.js を使った3D描画に対応し、外部GLBアセットの馬モデルを読み込んで走らせます。

## 主な機能

- 8頭立てのレースシミュレーション
- 単勝、複勝、馬連、馬単、ワイド、三連複、三連単のベット
- ローカル複数人プレイ
- Firebase設定時のオンライン部屋作成・参加
- 3D競馬場、外部馬モデル、ライブ順位表示
- スマホ、タブレット、PC向けレスポンシブ表示

## 使用技術

- HTML / CSS / JavaScript
- Three.js
- GLTFLoader
- Firebase Firestore

## 起動方法

```bash
python -m http.server 5173
```

ブラウザで `http://localhost:5173/` を開きます。
Windowsで `python` がMicrosoft Storeのエイリアスを指す場合は、代わりに次を使えます。

```bash
py -m http.server 5173
```

オンライン対戦を使う場合は `src/firebase-config.js` にFirebase設定を入れてください。

## ディレクトリ構成

```text
.
├── assets/
│   ├── app-icon.svg
│   ├── favicon.svg
│   └── ogp.svg
├── src/
│   ├── race.js
│   ├── race3d.js
│   ├── raceui.js
│   └── ...
├── firestore.rules
├── index.html
├── style.css
└── README.md
```

## 今後の改善案

- 馬モデル、騎手、観客席、実況演出の追加
- レース中カメラの切り替え
- スタートゲートやゴール写真演出の3D化
- PWA対応と192x192 / 512x512 PNGアイコン追加
- 文字化けしている既存UI文言の整理
