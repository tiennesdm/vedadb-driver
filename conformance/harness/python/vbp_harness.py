#!/usr/bin/env python3
"""VBP v1 conformance skeleton harness (Python).

Loads ``conformance/vbp_suite.yaml``, iterates every test case,
emits a JUnit XML report, and SKIPs every test (no test cases are
driven end-to-end yet — this is the SKELETON that downstream
work will fill in). Exit code 0 on success (loading + iteration
+ JUnit emit), 1 only if YAML loading or JUnit emit itself fails.

Usage::

    python3 vbp_harness.py \
        --suite ../../vbp_suite.yaml \
        --addr  127.0.0.1:6380 \
        --out   ./vbp-conformance-python.junit.xml

Dependencies: stdlib only (``yaml`` is in PyYAML; if not available
we fall back to a stdlib-only YAML subset sufficient for this
file's flat structure). This is intentional — the harness must
be runnable in CI without extra packages.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import xml.etree.ElementTree as ET
import xml.dom.minidom as minidom
from typing import Any, Dict, List


# ---------------------------------------------------------------------------
# Minimal YAML loader — PyYAML is preferred; otherwise we use a tiny
# flat-list parser that is good enough for vbp_suite.yaml's structure
# (the suite is mostly a list of mappings with a known schema).
# ---------------------------------------------------------------------------

def _load_yaml(path: str) -> Dict[str, Any]:
    try:
        import yaml  # type: ignore
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)
    except ImportError:
        return _flat_yaml_load(path)


def _flat_yaml_load(path: str) -> Dict[str, Any]:
    """A stdlib-only loader for the small subset of YAML our suite uses.

    Supported:
      - top-level scalars (`version: 2`, `suite: vbp-conformance-v1`)
      - a top-level `tests:` list of `-` blocks, each containing
        `id:`, `name:`, `category:`, and arbitrary nested key:value
        pairs.

    Not supported: anchors, multi-doc, flow-style sequences. The
    real vbp_suite.yaml is block-style, which this handles.
    """
    with open(path, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()

    out: Dict[str, Any] = {}
    tests: List[Dict[str, Any]] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if not s or s.startswith("#"):
            i += 1
            continue
        if s.startswith("- "):
            # New test case starts
            cur: Dict[str, Any] = {}
            # Strip the leading "- "
            first = s[2:].strip()
            if ":" in first:
                k, _, v = first.partition(":")
                cur[k.strip()] = _parse_scalar(v.strip())
            # Subsequent indented lines belong to this test
            i += 1
            while i < len(lines):
                nxt = lines[i]
                if not nxt.strip():
                    i += 1
                    continue
                stripped = nxt.lstrip()
                indent = len(nxt) - len(stripped)
                if stripped.startswith("- "):
                    # Same-level list item starts a new test
                    break
                if indent == 0 and stripped:
                    # back to top-level
                    break
                if ":" in stripped:
                    k, _, v = stripped.partition(":")
                    cur[k.strip()] = _parse_scalar(v.strip())
                i += 1
            tests.append(cur)
            continue
        if ":" in s:
            k, _, v = s.partition(":")
            out[k.strip()] = _parse_scalar(v.strip())
        i += 1
    if tests:
        out["tests"] = tests
    return out


def _parse_scalar(v: str) -> Any:
    """Parse a YAML scalar value (very small subset)."""
    if v == "" or v is None:
        return None
    low = v.lower()
    if low == "true":
        return True
    if low == "false":
        return False
    if low in ("null", "~"):
        return None
    if v.startswith('"') and v.endswith('"'):
        return v[1:-1]
    if v.startswith("'") and v.endswith("'"):
        return v[1:-1]
    if v.startswith("[") and v.endswith("]"):
        # Flow-style list: split on commas, strip
        inner = v[1:-1].strip()
        if not inner:
            return []
        return [_parse_scalar(p.strip()) for p in inner.split(",")]
    if v.startswith("{") and v.endswith("}"):
        inner = v[1:-1].strip()
        if not inner:
            return {}
        out = {}
        for pair in inner.split(","):
            if ":" not in pair:
                continue
            k, _, val = pair.partition(":")
            out[k.strip()] = _parse_scalar(val.strip())
        return out
    # Try int
    try:
        return int(v)
    except ValueError:
        pass
    # Try float
    try:
        return float(v)
    except ValueError:
        pass
    return v


# ---------------------------------------------------------------------------
# JUnit emit
# ---------------------------------------------------------------------------

def write_junit(outcomes: List[Dict[str, Any]], path: str, suite_name: str) -> None:
    suites: Dict[str, List[Dict[str, Any]]] = {}
    for o in outcomes:
        suites.setdefault(o["category"], []).append(o)

    root = ET.Element("testsuites")
    for cat in sorted(suites.keys()):
        s = ET.SubElement(root, "testsuite", attrib={
            "name": cat,
            "tests": str(len(suites[cat])),
            "failures": str(sum(1 for o in suites[cat] if o["status"] == "fail")),
            "skipped": str(sum(1 for o in suites[cat] if o["status"] == "skip")),
            "errors":   str(sum(1 for o in suites[cat] if o["status"] == "error")),
            "time":     f"{sum(o['duration'] for o in suites[cat]):.3f}",
        })
        for o in suites[cat]:
            tc = ET.SubElement(s, "testcase", attrib={
                "classname": suite_name,
                "name": f"{o['id']} {o['name']}",
                "time": f"{o['duration']:.3f}",
            })
            if o["status"] == "fail":
                f = ET.SubElement(tc, "failure")
                f.text = o["message"]
            elif o["status"] == "skip":
                sk = ET.SubElement(tc, "skipped")
                sk.text = o["message"]
            elif o["status"] == "error":
                e = ET.SubElement(tc, "error")
                e.text = o["message"]
    rough = ET.tostring(root, encoding="utf-8")
    pretty = minidom.parseString(rough).toprettyxml(indent="  ", encoding="utf-8")
    with open(path, "wb") as f:
        f.write(pretty)


# ---------------------------------------------------------------------------
# Test runner
# ---------------------------------------------------------------------------

def run_test(t: Dict[str, Any], addr: str, user: str, pass_: str) -> Dict[str, Any]:
    """Skeleton: every test is SKIP.

    Downstream work will replace this with the actual Python
    driver test invocation. The skeleton is honest: it does NOT
    fake a pass.
    """
    start = time.time()
    return {
        "id": t.get("id", 0),
        "name": t.get("name", "unknown"),
        "category": t.get("category", "unknown"),
        "status": "skip",
        "message": "Python harness: skeleton — no test cases driven end-to-end (TODO: port vbp_harness.go to python)",
        "duration": time.time() - start,
    }


def main() -> int:
    p = argparse.ArgumentParser(description="VBP v1 conformance skeleton (Python).")
    p.add_argument("--suite", default="conformance/vbp_suite.yaml", help="path to vbp_suite.yaml")
    p.add_argument("--addr", default="127.0.0.1:6380", help="VBP server address (unused in skeleton)")
    p.add_argument("--out", default="vbp-conformance-python.junit.xml", help="JUnit XML output")
    p.add_argument("--user", default="admin", help="auth username (unused in skeleton)")
    p.add_argument("--pass", dest="pass_", default="TestPassword123!", help="auth password (unused in skeleton)")
    p.add_argument("--category", default="", help="filter to one category")
    p.add_argument("-v", "--verbose", action="store_true", help="verbose progress")
    args = p.parse_args()

    if not os.path.exists(args.suite):
        print(f"ERROR: suite file not found: {args.suite}", file=sys.stderr)
        return 2

    suite = _load_yaml(args.suite)
    tests = suite.get("tests", []) or []
    if args.category:
        tests = [t for t in tests if t.get("category") == args.category]
    suite_name = suite.get("suite", "vbp-conformance-v1")

    outcomes = [run_test(t, args.addr, args.user, args.pass_) for t in tests]

    try:
        write_junit(outcomes, args.out, suite_name)
    except Exception as e:
        print(f"ERROR: write JUnit: {e}", file=sys.stderr)
        return 2

    pass_n = sum(1 for o in outcomes if o["status"] == "pass")
    fail_n = sum(1 for o in outcomes if o["status"] == "fail")
    skip_n = sum(1 for o in outcomes if o["status"] == "skip")
    err_n  = sum(1 for o in outcomes if o["status"] == "error")
    print("VBP v1 conformance (Python skeleton)")
    print(f"  tests:  {len(outcomes)}")
    print(f"  pass:   {pass_n}")
    print(f"  fail:   {fail_n}")
    print(f"  skip:   {skip_n}")
    print(f"  error:  {err_n}")
    print(f"  report: {args.out}")
    return 1 if (fail_n + err_n) > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
