# 落ち砂サンドボックス (Sand Studio) v0.1

指でなぞるだけ → 砂・水・油・植物・火が**創発的に**ふるまう世界が生まれ →
その一点もののループを**録画してSNS共有**できる、モバイルWeb優先の落ち砂サンドボックス。

決定論セルオートマトン（seed対応）なので、同じ種からは同じ世界が再現できます。

## 物質と挙動

| 物質 | ふるまい |
| --- | --- |
| 砂 | 安息角で堆積する粉体。流体より重いので沈む |
| 水 | 密度で沈降し、横に広がって水位をつくる |
| 油 | 水より軽く水の上に浮く。可燃 |
| 植物 | 隣の水へ成長する。可燃 |
| 火 | 植物・油へ延焼し、寿命で燃え尽きる |
| 石 / 壁 | 動かない固体 |
| 消しゴム | セルを空にする |

水が火に触れると火を消して**蒸気**になり、蒸気は立ちのぼって消えます。

## 開発

```bash
npm install
npm run dev        # 開発サーバ
npm run typecheck  # 型チェック
npm test           # vitest（シミュレーションの決定論・物理テスト）
npm run build      # 本番ビルド (dist/)
npm run gen-icons  # PWAアイコンPNGを再生成
```

## 構成

```
src/
  sim/      決定論セルオートマトン（純TS・vitestでテスト）
            materials.ts / rng.ts / simulation.ts
  render/   Renderer インターフェース + Canvas2DRenderer（putImageData）
  capture/  MediaRecorder 録画 → navigator.share 共有（mime自動判定・DLフォールバック）
  ui/       React タッチUI（9:16縦キャンバス・物質パレット・録画ボタン）
```

- **React + Vite + TypeScript / PWA**
- キャンバスはグリッド解像度 **180×320 (9:16)** をバッキングストアにして
  `image-rendering: pixelated` で拡大表示
- `vite base: './'` なので GitHub Pages のサブパス配信でも動作

## デプロイ

`main` への push で [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)
が typecheck → test → build → GitHub Pages 公開まで自動実行します。
リポジトリの **Settings → Pages → Source** を **GitHub Actions** に設定してください。

## アーキテクチャ方針（後続）

レンダリングは `Renderer` インターフェースの差し替えで段階的に強化する想定です。

Canvas2D（現在） → WebGL2 (regl) 発光 → WASMシミュ + dirty-rect → （任意）WebGPU。
WebGL2 が本番基盤（iOS15+）、WebGPU は iOS26+ で上乗せのみ。

## 次のマイルストーン

1. 実機 iOS で録画／共有を検証
2. デイリー共有シード
3. WebGL2 発光レンダラ
4. リミックスギャラリー（Supabase）

## ライセンス

MIT
