# Maintainer: nino-natsume <1093219307@qq.com>
pkgname=eri-ai-debug
pkgver=0.0.2
pkgrel=1
pkgdesc='Eri AI debug/test build: cross-platform terminal TUI and multi-CLI persona manager'
arch=('any')
url='https://github.com/nino-natsume/eri-ai-debug'
license=('AGPL-3.0-or-later')
depends=('nodejs' 'npm' 'opencode')
makedepends=('git')
optdepends=(
  'bash: 旧版 Shell 安装入口'
)
install=eri.install
source=("eri-ai-debug::git+https://github.com/nino-natsume/eri-ai-debug.git#tag=v${pkgver}")
sha256sums=('SKIP')

prepare() {
  cd "$srcdir/eri-ai-debug"
  local source_version
  source_version="$(node -p "require('./package.json').version")"
  if [[ "$source_version" != "$pkgver" ]]; then
    printf '错误：Git 标签中的 package.json 版本为 %s，但 PKGBUILD pkgver 为 %s。\n' "$source_version" "$pkgver" >&2
    return 1
  fi
}

package() {
  local src="$srcdir/eri-ai-debug"
  local dest="$pkgdir/usr/share/eri-ai-debug"
  install -d "$dest" "$pkgdir/usr/bin" "$pkgdir/usr/share/licenses/$pkgname"

  local f
  for f in \
    README.md docs/tui-preview.png LICENSE package.json index.js sync-version.js install-eri.sh install-eri.ps1 \
    eri.md personality.json opencode.json opencode-package.json SKILL.md \
    erotic-chan.md code-monkey.md debug-san.md architect-sama.md test-chan.md eri.install \
    agents/eri.md agents/erotic-chan.md agents/code-monkey.md agents/debug-san.md agents/architect-sama.md agents/test-chan.md \
    lib/config.js lib/jsonc-lite.js lib/tui.js lib/font.js ui/core.js ui/ring.js \
    test/cli.test.js test/config.test.js test/jsonc-lite.test.js test/ring.test.js test/tui.test.js test/tui-screen.test.js test/packaging.test.js test/font.test.js; do
    if [[ ! -f "$src/$f" ]]; then
      printf '错误：源文件缺失：%s\n' "$src/$f" >&2
      return 1
    fi
    install -D -m 644 "$src/$f" "$dest/$f"
  done

  chmod 755 "$dest/index.js" "$dest/install-eri.sh"
  install -m 644 "$src/LICENSE" "$pkgdir/usr/share/licenses/$pkgname/LICENSE"

  cat > "$pkgdir/usr/bin/eri-ai-debug" <<'ERI_LAUNCHER'
#!/bin/sh
exec node /usr/share/eri-ai-debug/index.js "$@"
ERI_LAUNCHER
  chmod 755 "$pkgdir/usr/bin/eri-ai-debug"
}
