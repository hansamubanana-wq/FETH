# Codex実装指示書: オフライン起動できる状態にする（CDN解消＋画像最適化＋PWA）v0.18.0

アプリ版（Capacitor）リリースへの前提整備。Web版にも効く改善なので先に実施する。

## 1. CDN依存の解消（必須・最優先）

現在、起動に外部ドメインが必要で**圏外・機内モードでは遊べない**。
ストア配信アプリでは致命的（審査落ちの典型）で、Appleは外部からの実行コード読み込みも嫌う。

解消する依存:

| 依存 | 現在 | 対応 |
|---|---|---|
| three.js 本体 | `https://unpkg.com/three@0.165.0/build/three.module.js`（index.html の importmap） | `vendor/three/` に同梱してローカルパスへ |
| three.js addons | `https://unpkg.com/three@0.165.0/examples/jsm/` | 実際に使っている物だけ同梱（GLTFLoader, SkeletonUtils 等）。使っていない物は入れない |
| Firebase SDK | `https://www.gstatic.com/firebasejs/10.12.2/firebase-{app,firestore}.js`（src/online.js の動的import） | `vendor/firebase/` に同梱してローカルパスへ |
| 馬の3Dモデル | `https://threejs.org/examples/models/gltf/Horse.glb`（src/race3d.js） | `assets/models/horse.glb` に同梱 |

注意事項:
- **バージョンは現在と同じものを固定**（three 0.165.0 / firebase 10.12.2）。アップグレードは今回やらない
- three.js は minified ビルドでよい。**ライセンス表記（MITヘッダ）は削除しないこと**
- Firebase SDK も同様にライセンスヘッダを保持
- 同梱はコミットに含める（`.gitignore` の node_modules とは別扱い）
- **ビルド工程は導入しない**。importmap のURLをローカルパスに差し替えるだけ
- Firebase SDK の動的import（オンラインに入るまで読まない遅延読み込み）の挙動は維持すること
- 馬GLBの読み込み失敗時のフォールバック描画は現状のまま維持

## 2. 画像の最適化（配信36MB → 5MB以下を目標）

現状、表示サイズに対して画像が過大。実測:

| 対象 | 現状 | 表示サイズ | 対応 |
|---|---|---|---|
| `assets/art/horses/horse1〜8.png` | **各2.4〜2.8MB / 1254×1254**（計約21MB） | 馬選択カード52px、結果画面132px程度 | **256×256程度に縮小**。各50KB以下を目標 |
| `assets/art/victory.png` | 2.2MB / 1536×1024 | 結果画面のバナー | 横1024px程度に縮小・圧縮 |
| `assets/art/bg-home.png` / `bg-paddock.png` / `bg-stadium.png` | 各約2MB / 1672×941 | 全画面背景 | 横1280〜1600px程度に抑え、各300KB以下を目標 |
| `assets/art/logo.png` | 1.7MB / 1254×1254 | ホームのエンブレム 136〜192px | 384×384程度に縮小 |
| `assets/art/ogp.png` | 1.6MB / 1200×630 | OGP（1200×630必須） | **寸法は維持**し圧縮のみ。300KB以下目標 |
| `assets/art/tex/` | 868KB | — | **適正なので変更しない** |
| `assets/art/icon-192/512.png` | — | PWAアイコン | 寸法維持・圧縮のみ |

- **image 2.0での再生成は不要**。既存画像の縮小・圧縮でよい（絵柄を変えない）
- 縮小後、**実際の画面で劣化が分かるほど荒れていないこと**を確認する
  （特に馬の肖像は結果画面で132px表示。256pxなら余裕がある）
- 前ラウンドで作った `assets/art/tex/half/` は品質ティア用なのでそのまま維持
- **最終的な配信合計サイズを報告すること**

## 3. Service Worker 追加でPWA完成

- `sw.js` を追加し、`index.html` から登録する
- **事前キャッシュ**: HTML / CSS / JS / vendor / テクスチャ / アイコン / 背景画像など、
  オフライン起動に必要な資産を install 時にキャッシュする
- **更新の扱いが最重要**: 既存の更新通知機構（`src/version.js` の `APP_BUILD` と
  Firestore `meta/version` を比較してバナーを出す）と**衝突しないこと**。
  - キャッシュ名に `APP_BUILD` を含め、**ビルド番号が変わったら旧キャッシュを破棄**する
  - `src/version.js` は**キャッシュ優先にしない**（ネット優先 or キャッシュ回避）。
    ここをキャッシュすると新バージョンを検知できず、更新バナーが永久に出なくなる
  - 「更新があります」バナーからのリロードで**確実に新版が反映される**ことを実機で確認
- Firestore への通信は Service Worker で**キャッシュしない**（常にネットワーク）
- オフライン時: ローカル対戦は完全に動作すること。オンラインは繋がらない旨を穏当に表示
- `manifest.webmanifest` は既に整備済み（standalone / landscape / icons 192・512）なので変更不要

## 制約（毎回同じ・必読）

- ビルドなし静的サイト維持、Vanilla JS + three.js
- 見た目・操作・ゲームバランス・レース映像は変えない
- 動的カメラの「全馬が常に画面内」ロジックには手を入れない
- 前ラウンドの品質ティア機能（自動/低/中/高）を壊さない
- オンライン対戦のシード同期を壊さない
- 完了時 `src/version.js` を APP_VERSION 0.18.0 / APP_BUILD 24 に、index.htmlのバッジも更新
  （※前ラウンドが 23 を使っている場合は 24。重複しないよう必ず現在値を確認すること）
- タスクごとに日本語メッセージで独立コミット。push・デプロイはしない

## 検証（自己申告禁止・必ず実行して数値を報告）

1. `node scripts/smoke-boot.mjs` … 起動・ローカル対戦がエラー0
2. `node scripts/verify-camera-framing.mjs 6` … フレームアウト0・最悪NDC 0.95以下
3. `node scripts/monte-carlo-balance.mjs` … 勝率分布・着差が不変
4. `node scripts/verify-online-e2e.mjs` … オンライン2人が結果画面まで到達
5. **オフライン検証**: Playwrightで `context.setOffline(true)` にした状態で
   （＝2回目の起動を想定し、事前に1度読み込んでSWをインストール済みにしてから）
   ホーム→ローカル対戦→レース→結果まで**完走できること**を自動テストで確認する。
   このテストを `scripts/verify-offline.mjs` として追加すること
6. **外部通信ゼロの確認**: レース開始までの間に unpkg / threejs.org / gstatic への
   リクエストが**1件も出ていない**ことを Playwright の request 監視で確認して報告
   （Firestore への通信はオンラインモードに入った時のみ許容）
7. **配信サイズ**: 最適化前後の合計サイズと、主要ファイルの個別サイズ一覧を報告
