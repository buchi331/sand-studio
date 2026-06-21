# 落ち砂サンドボックス — リアル化 設計 (2026-06-22)

## ゴール

既存8物質のまま、**見た目の質感**と**物理の挙動**を本物らしくし、SNS共有したくなる
「見惚れるループ」を強化する。レンダラは最終的に **WebGL2(regl) 発光**へ移行する。

### スコープ内
- 物理のリアル化（粘性差・自然な堆積・火の温度）。決定論は維持。
- WebGL2 発光レンダラ（ブルーム）。Canvas2D は非対応端末向けフォールバックとして残す。
- 録画/共有が WebGL2 でも動くことの担保。

### スコープ外（今回やらない）
- 新物質・新反応の追加（溶岩/酸/氷/煙/灰 等）。
- グリッド解像度の引き上げ（180×320 のまま）。
- WebGPU。

## 進行順（合意済み）

① 物理リアル化(TDD) → ② レンダラ抽象の地固め → ③ WebGL2発光 → ④ 録画担保 → ⑤ 検証

各フェーズは独立して typecheck/test/build を緑に保ち、デプロイ可能な状態で進める。

---

## フェーズ① 物理リアル化（純TS・決定論・TDD）

レンダラに依存しない純ロジック。先に固めて WebGL2 の土台をテスト済みにする。

### 1. 物質ごとの粘性モデル
液体更新に物質パラメータを導入する（`materials.ts` の物質メタに集約）。

| 物質 | dispersion(横探索幅) | flowChance(横移動確率) | 体感 |
| --- | --- | --- | --- |
| 水 | 大（例 6） | 1.0 | サラサラ・水位が速く平らに |
| 油 | 小（例 1〜2） | 低（例 0.4） | トロトロ・盛り上がりやすい |

- `flowSideways` を「物質ごとの dispersion」で動かし、横移動を `flowChance` のRNGゲートで間引く。
- 落下・対角・密度沈降のロジックは現状維持（沈降/浮上テストを壊さない）。

### 2. 砂の自然な堆積
- **挙動は現状維持**（既存の対角スライドで安息角は十分自然。下手に触ると密度沈降テストを壊すリスク大）。
- 「砂に見える」質感は描画側の**粒ごと色ゆらぎ**（②③ の `VARIATION`）で実現する。

### 3. 火の温度（描画で表現）
- **挙動は現状維持**。`life`(0..`FIRE_LIFE`) を「温度」として**描画側が読む**。
- レンダラが読めるよう、②で `Simulation.life` を公開し `GridView` に `life` を追加する。
- 火: 芯(高life)=白熱 → 縁(低life)=暗赤。蒸気: life で濃さが薄れる。

### テスト（vitest 追加）
- 水は油より速く横に広がる（同条件Nステップ後、水の広がり幅 > 油の広がり幅）。
- 決定論維持（同seed同操作で `cells` 一致）。
- 既存22テスト（落下/堆積/密度沈降/浮上/延焼/消火→蒸気/成長/静的）が緑のまま。

> 注: フェーズ①の実装は**液体の粘性差のみ**。砂挙動・火の減衰は現状維持（質感は描画で表現）。

---

## フェーズ② レンダラ抽象の地固め（小リファクタ）

### `Renderer` インターフェース拡張
```ts
interface Renderer {
  init(canvas, gridW, gridH): void
  resize(displayW: number, displayH: number, dpr: number): void // 追加: 発光を表示解像度で
  render(grid: GridView): void
  dispose(): void
}
interface GridView {
  width: number; height: number
  cells: Uint8Array
  life: Uint8Array   // 追加: 火の温度・蒸気の濃さ
}
```
- `Canvas2DRenderer.resize` は no-op（グリッド解像度で描画するため）。
- `Simulation` は `life` を読み取り公開（現状 private → 公開 getter かフィールド公開）。

### レンダラ・ファクトリ
```ts
createRenderer(canvas, gridW, gridH): { renderer: Renderer; backend: 'webgl2' | 'canvas2d' }
```
- `canvas.getContext('webgl2')` を試し、取得できれば `WebGL2Renderer`、不可なら `Canvas2DRenderer`。
- `webgl2` が null の場合は context は未バインドなので 2d 取得は安全。
- `App` はベタ書きの `new Canvas2DRenderer()` をやめてファクトリ経由に。backend を status に表示（デバッグ用）。

### 物質メタの集約（`materials.ts`）
- 既存 `COLORS` に加え、`EMISSIVE`（発光する物質: 火・蒸気）と
  `VARIATION`（色ゆらぎ振幅）を定義し、**両レンダラで共有**。
- `Canvas2DRenderer` も更新し、現状のフレームカウンタ式フリッカを
  `life`（火の温度）＋ `VARIATION`（色ゆらぎ）ベースに置き換える。
  → WebGL2 とフォールバックで見た目の方向性を揃える（発光ブルームの有無のみ差）。

---

## フェーズ③ WebGL2 発光レンダラ（regl）

`regl` を依存に追加（ロードマップ準拠。生WebGL2でも可だがFBO/quad管理が楽）。

### パイプライン
1. **転送**: `cells`(R) と `life`(G) を 180×320 の uint8 RGテクスチャに毎フレーム `subimage`。
2. **シーン描画**: フルスクリーンquad。フラグメントシェーダで
   - グリッドテクスチャを **nearest** サンプル（ピクセルくっきり維持）。
   - material→基本色（uniform パレット9色, `materials.ts` 由来）。
   - セル座標ハッシュで色ゆらぎ（`VARIATION`）。
   - 水: 深さ（上に何セル水があるか近似）で陰影、表面ハイライトで透明感。
   - 火: `life` で 白熱→橙→暗赤 のグラデ。
   - → 表示解像度のオフスクリーンFBOへ。
3. **ブライトパス**: `EMISSIVE` 物質のみ抽出（低解像 1/2〜1/4）。
4. **ブラー**: 分離ガウシアン（H→V）。
5. **合成**: シーン + ブラー(加算) を画面へ。

- シミュはnearestでドット感維持、発光だけ滑らか。
- 精度は `mediump` 基本、必要箇所のみ `highp`。

---

## フェーズ④ 録画との両立（🔴最重要の事前担保）

WebGL2 は既定で描画バッファが合成後にクリアされ、`canvas.captureStream()` →
MediaRecorder が**空フレーム**を拾うことがある。録画/共有は拡散の核なので必須対応。

- WebGL2 context を **`preserveDrawingBuffer: true`** で生成（regl は `attributes` で指定）。
- 既存 `capture/recorder.ts` はそのまま流用（mime自動判定＋DLフォールバック）。
- 受け入れ: WebGL2 経路で録画→再生してフレームが映ること（PC/実機iOS）。
- わずかな描画コスト増は 180×320 表示では許容。

---

## フェーズ⑤ 検証

- `npm run typecheck` / `npm test` / `npm run build` すべて緑。
- GitHub Pages デプロイ → 実機iOSで発光表示・録画/共有を確認。
- ヘッドレスのスクショは常時アニメで失敗するため、コンソールログ＋手動/実機で確認。

---

## アーキテクチャ要点（境界）

- **sim**: 純ロジック。`cells` と `life` を公開するだけ。描画を一切知らない。
- **render**: `Renderer` 実装2種（Canvas2D / WebGL2）。`GridView`(読み取り専用) だけに依存。
- **materials**: 色・発光・ゆらぎ・物理パラメータの**唯一の真実**。sim も render も参照。
- **capture**: canvas に対してのみ動作。レンダラ実装に非依存（context設定だけ④で担保）。

## リスクと対策
- WebGL2 非対応端末 → Canvas2D 自動フォールバック。
- `preserveDrawingBuffer` の負荷 → 低解像度のため許容。
- モバイルGPU差異 → `mediump` 基本＋実機確認。
- regl のバンドル増 → 小規模で許容。

## テスト戦略
- 物理: vitest（決定論・粘性差・水位形成・既存不変条件）。
- レンダラ: ピクセル単体テストは行わず、**ファクトリのフォールバック判定**のみ単体テスト
  （jsdom に webgl が無いため Canvas2D に落ちることを確認）。
- 発光の見た目・WebGL2録画: 手動＋実機。
