# FETH（みんなで競馬）開発ガイド

お金を賭けないコイン制の競馬ベットゲーム（日本語UI）。ビルド工程なしの静的サイト。

## 技術構成

- Vanilla JS (ES Modules)。ビルド・バンドラ・パッケージマネージャなし
- three.js は `index.html` の importmap で unpkg (`three@0.165.0`) から読み込む
- オンライン対戦のみ Firebase Firestore を動的読み込み（`src/firebase-config.js` に設定）
- 起動は静的サーバーで配信するだけ（例: `python3 -m http.server`）

## 主要ファイル

- `src/engine.js` — レース生成・馬券精算のコアロジック
- `src/race.js` — レースの事前計算シミュレーション（決定論的、シード共有）と再生プレイヤー
- `src/race3d.js` — three.js の3D描画。動的カメラ（全馬が常に画面内）、コース装飾、ゴール演出
- `src/betui.js` / `src/raceui.js` — ベットUI・レース/結果UI
- `src/local.js` / `src/online.js` — ローカル/オンライン進行管理
- `style.css` — 全スタイル（ゴールド基調）

## 変更時の注意

- オンライン対戦は全端末が同じシードから同じレースを決定論的に再現する設計。
  `src/race.js` のシミュレーション部（`simulateOrder` / `simulateRaceData`）の
  乱数消費順序を変えると端末間で結果がズレるため注意
- レース中のカメラは1位と最下位が必ず両方画面に収まる動的カメラ（`src/race3d.js`）。
  カメラや描画対象の位置を変えたら、フレームアウトしないことを確認する
- バージョンは `src/version.js` と `index.html` のバッジの両方を更新する（更新バナー機構が参照）
- コミットメッセージは日本語

## 検証

- Playwright でローカル対戦を通しプレイして確認できる
  （ホーム → ローカル → 馬選択 → ベット確定 → ベット終了 → レース → 結果）
- 馬の GLB モデル（threejs.org）が読めない環境でもフォールバック描画で検証可能
