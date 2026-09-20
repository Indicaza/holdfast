#!/usr/bin/env bash

set -euo pipefail

CALLER_DIR="$(pwd)"
OUTPUT="${1:-context001.txt}"

if (($# >= 1)); then
    shift
fi

ROOT="${1:-.}"

if (($# >= 1)); then
    shift
fi

FILES=("$@")

if [[ "$OUTPUT" != /* ]]; then
    OUTPUT="$CALLER_DIR/$OUTPUT"
fi

cd "$ROOT"

print_tree() {
    if command -v tree >/dev/null 2>&1; then
        tree -a \
            -I "node_modules|.git|dist|build|coverage|.vite|context*.txt|*.patch"
        return
    fi

    find . \
        -type d \( \
            -name node_modules -o \
            -name .git -o \
            -name dist -o \
            -name build -o \
            -name coverage -o \
            -name .vite \
        \) -prune -o \
        -type f \
        ! -name "context*.txt" \
        ! -name "*.patch" \
        -print | sort
}

{
    echo "============================================================"
    echo "HOLDFAST DEVELOPMENT CONTEXT"
    echo "============================================================"
    echo

    echo "=== REPOSITORY ==="
    git remote get-url origin 2>/dev/null || true
    echo

    echo "=== BRANCH ==="
    git branch --show-current 2>/dev/null || true
    echo

    echo "=== HEAD ==="
    git rev-parse HEAD 2>/dev/null || true
    echo

    echo "=== GIT STATUS ==="
    git status --short 2>/dev/null || true
    echo

    echo "=== PROJECT TREE ==="
    print_tree
    echo

    for FILE in "${FILES[@]}"; do
        echo
        echo "============================================================"
        echo "FILE: $FILE"
        echo "============================================================"

        if [[ -f "$FILE" ]]; then
            cat "$FILE"
        else
            echo "[FILE NOT FOUND]"
        fi
    done
} > "$OUTPUT"

echo "Created $OUTPUT"
