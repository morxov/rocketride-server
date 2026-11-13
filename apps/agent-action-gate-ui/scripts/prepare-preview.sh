#!/bin/sh
set -eu

fail() { printf '%s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = Darwin ] || fail 'This preview helper is for macOS.'
[ "$#" -le 1 ] || fail 'Usage: prepare-preview.sh [RocketRide Redis PR checkout]'
installed_engine=${ROCKETRIDE_ENGINE_DIR:-"$HOME/Library/Application Support/RocketRide/engine"}
port=${ROCKETRIDE_DEMO_PORT:-5565}
base_port=${ROCKETRIDE_DEMO_BASE_PORT:-31000}
pr_sha=2c59071407225121f053e30d2c61b84761d2a7aa
source_url=https://codeload.github.com/rocketride-org/rocketride-server/tar.gz

[ -x "$installed_engine/engine" ] || fail 'Open RocketRide in VS Code once to install the local engine, or set ROCKETRIDE_ENGINE_DIR.'
if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "Port $port is already in use. Connect to the running preview or set ROCKETRIDE_DEMO_PORT."
fi
if [ -n "${ROCKETRIDE_DEMO_ENV_FILE:-}" ]; then
    set -a
    . "$ROCKETRIDE_DEMO_ENV_FILE"
    set +a
fi

umask 077
runtime=$(mktemp -d "${TMPDIR:-/tmp}/rocketride-agent-action-gate.XXXXXXXX")
mkdir "$runtime/data" "$runtime/pr"
cp -cR "$installed_engine" "$runtime/engine"
engine_dir=$runtime/engine
if [ -f "$engine_dir/.env" ]; then
    unlink "$engine_dir/.env"
fi

if [ "$#" -eq 1 ]; then
    git -C "$1" archive --output="$runtime/pr.tar" "$pr_sha" \
        nodes/src/nodes/tool_redis nodes/src/nodes/agent_llamaindex/llamaindex.py
    tar -xf "$runtime/pr.tar" -C "$runtime/pr"
else
    curl -fsSL "$source_url/$pr_sha" -o "$runtime/pr.tar.gz"
    tar -xzf "$runtime/pr.tar.gz" -C "$runtime/pr" --strip-components=1 \
        --include '*/nodes/src/nodes/tool_redis/*' --include '*/nodes/src/nodes/agent_llamaindex/llamaindex.py'
    unlink "$runtime/pr.tar.gz"
fi
mkdir -p "$engine_dir/nodes/tool_redis"
cp -R "$runtime/pr/nodes/src/nodes/tool_redis/." "$engine_dir/nodes/tool_redis/"
cp "$runtime/pr/nodes/src/nodes/agent_llamaindex/llamaindex.py" "$engine_dir/nodes/agent_llamaindex/"

shell_package=$engine_dir/static/clients/shell/shell.tgz
if [ ! -s "$shell_package" ]; then
    for tool in node npm pnpm; do
        command -v "$tool" >/dev/null || fail "Install $tool to build RocketRide's Shell package."
    done
    engine_sha=$("$engine_dir/engine" --version | awk '/hash:/ { for (i=1; i<NF; i++) if ($i == "hash:") print $(i+1) }')
    [ -n "$engine_sha" ] || fail 'Could not read the installed engine source hash.'
    shell_source=$runtime/shell-source
    mkdir -p "$shell_source/packages/client-typescript" "$runtime/pack-output"
    curl -fsSL "$source_url/$engine_sha" -o "$runtime/shell-source.tar.gz"
    tar -xzf "$runtime/shell-source.tar.gz" -C "$shell_source" --strip-components=1 --include '*/packages/shell/*'
    unlink "$runtime/shell-source.tar.gz"
    set -- "$engine_dir"/static/clients/typescript/rocketride-*.tgz
    [ -f "$1" ] || fail 'Could not find the TypeScript client package in the installed engine.'
    tar -xzf "$1" --strip-components=1 -C "$shell_source/packages/client-typescript"
    esbuild_version=$(node -p 'require(process.argv[1]).devDependencies.esbuild' "$shell_source/packages/shell/package.json")
    npm install --prefix "$runtime/pack-tools" --no-audit --no-fund "esbuild@$esbuild_version"
    printf '{"private":true}\n' > "$runtime/pack-output/package.json"
    NODE_PATH="$runtime/pack-tools/node_modules" ROCKETRIDE_DIST_ROOT="$runtime/pack-output/dist" \
        node "$shell_source/packages/shell/scripts/pack-shell.js"
    mkdir -p "$(dirname "$shell_package")"
    cp "$runtime/pack-output/dist/server/static/clients/shell/shell.tgz" "$shell_package"
fi

cd "$engine_dir"
./engine -m pip install --disable-pip-version-check 'redis==7.4.1'
ping_redis() {
    ./engine -c 'import redis; redis.Redis(host="127.0.0.1", port=6381, socket_connect_timeout=1, socket_timeout=1).ping()' >/dev/null 2>&1
}

if ! ping_redis; then
    redis_server=$(command -v valkey-server || command -v redis-server || true)
    [ -n "$redis_server" ] || fail 'Start Valkey or Redis on 127.0.0.1:6381, or install valkey-server to let this script start it.'
    "$redis_server" --bind 127.0.0.1 --port 6381 --save '' --appendonly no --dir "$runtime/data" > "$runtime/valkey.log" 2>&1 &
    redis_pid=$!
    trap 'kill "$redis_pid" 2>/dev/null || true' EXIT
    sleep 1
    ping_redis || fail "Could not reach Valkey on 127.0.0.1:6381. See $runtime/valkey.log."
fi

unset ROCKETRIDE_APIKEY
printf 'Preview engine: http://127.0.0.1:%s\nRuntime: %s\n' "$port" "$runtime"
set -- ./engine ./ai/eaas.py --host=127.0.0.1 --port="$port" --base_port="$base_port"
if [ -z "${redis_pid:-}" ]; then
    exec "$@"
fi
"$@"
