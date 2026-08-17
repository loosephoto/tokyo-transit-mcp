# 並行作業規約（ブランチ・worktree）

**複数のLLM/エージェントが同時に開発するための分離規約**。`main` 直 push を避け、機能ブランチ＋git worktree で物理分離する。

## 基本方針
- **`main` への直コミットは原則禁止**。並行作業時は機能ブランチ＋worktree で分離し、検証後マージする。
- 1エージェント = 1ブランチ = 1worktree。所有ファイルが重ならない作業は並列実行してよい。

## Claude Code の git worktree 利用
```
# 機能ブランチをworktreeとして分離（.claude/worktrees/<name>/ に作成）
claude -w <feature-name>

# 分離されたworktree内で作業 → コミット → push
cd .claude/worktrees/<feature-name>
git push -u origin <feature-name>
```

## ブランチ命名規約
- 機能追加: `feat/<概要>`（例: `feat/station-alias-tokyo-metro`）
- 修正: `fix/<issue番号>-<概要>`（例: `fix/96-bus-transfer`）
- リファクタ: `refactor/<概要>`

## マージ手順
1. 自分のworktreeで全回帰（`node scripts/check-railway-integrity.mjs` 含む）が PASS したことを確認
2. `main` を取り込み最新化してからマージ（衝突を早期検出）
   ```
   git fetch origin && git merge origin/main
   ```
3. 衝突した場合、所有権マップ（`file-ownership.md`）に基づき、競合ドメインの担当と相談して解決

## 注意
- 共有ファイル（`src/config.mjs` / `src/index.mjs` / `search-route.mjs`）を複数エージェントが触る場合、**直列化**して1つずつマージする。
- worktree は終了後 `git worktree remove` でクリーンアップ。
