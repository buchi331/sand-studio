# 水槽透明化 — 中身を水槽の“中”に見せる (2026-06-22)

## ゴール

背景の写真水槽（`public/room-aquarium-bg.png`）はそのままに、**WebGL/Canvasキャンバスを透明化**して、砂・水などの中身だけが水槽の中に入って見えるようにする。「暗い板が水槽の前にある」状態を解消する。

前提: **録画は対象外**（ユーザー合意）。そのため背景をWebGLに取り込む複雑な実装は不要で、CSSで写真の上にキャンバスを重ね、キャンバス自体をピクセル単位で透過させる。

## スコープ
- 対象: WebGL2/Canvas2Dの透過出力、空セルの透明化、水の半透明化、CSSの暗化ハック撤去、写真水槽への位置合わせ（粗く合わせ、最終はユーザーが実機で微調整）。
- 対象外: 背景のWebGL取り込み、録画、シミュレーション挙動の変更（決定論・テスト維持）。

## 変更

### 1. WebGL2Renderer — 透明＋プリマルチプライドalpha
- コンテキストを `alpha: true` で生成（既定の premultipliedAlpha:true）。`preserveDrawingBuffer` は残置で可。
- **コンポジットの最終出力をalpha付きに**（現状 `vec4(c,1.0)`）。`uEmptyId/uFireId/uSteamId` uniformを追加し、ピクセルごとに:
  - 空セル → alpha 0（写真水槽が透ける）
  - 砂/石/壁/植物 → alpha 1
  - 火 → alpha 1、蒸気 → alpha ~0.8
  - 水（メタボール被覆 `mask`／深さ `depth`）→ alpha ~0.45–0.75（奥が透ける）
  - ブルーム発光 → 明るさに応じ alpha を加算（空の上でも光が見える）
  - 出力は **プリマルチプライド**: `gl_FragColor = vec4(col * a, a)`
- シーンパスの空セル色を“部屋の壁”描画から**暗い水色**に変更（透過時は見えないが、水が空セルへ滲む箇所の下地として自然に）。

### 2. Canvas2DRenderer — 透明背景
- コンテキストを `alpha: true` に。ImageDataの **空セルは alpha=0**、水は alpha ~190、その他 255。

### 3. CSS（styles.css）
- `.stage__canvas` の `opacity:0.52` / `mix-blend-mode:multiply` / `filter:...` を撤去（素のalpha合成）。
- `.tank-front-glass` の薄い前面反射は残す。
- `.tank-shell` のサイズ/位置は現状維持で粗く合わせ、最終値は実機スクショで微調整。

## 検証
- `readPixels`（alpha付き）で: 空セル alpha=0、砂セル alpha=255、水セル alpha=中間、を確認。
- `typecheck` / `test`(25) / `build` 緑。決定論・simは不変。
- 見た目の最終確認は実機（headlessはrAF非発火＋スクショ不可のため）。

## リスク
- プリマルチプライド/ブレンドの取り違えで色がにじむ → readPixelsのalphaで検証。
- 写真水槽との位置ズレ → CSSは粗く、ユーザーが実機で詰める。
