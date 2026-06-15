//! VBP v1 conformance skeleton harness (Rust).
//!
//! Loads `conformance/vbp_suite.yaml` using only the Rust stdlib
//! (a hand-rolled block-style YAML parser), iterates every test,
//! emits a JUnit XML report, and SKIPs all tests. Exit code 0 on
//! success, 1 on any FAIL/ERROR.
//!
//! Build:
//!   rustc -O vbp_harness.rs -o vbp_harness
//!
//! Run:
//!   ./vbp_harness --suite ../../vbp_suite.yaml --out ./vbp-conformance-rust.junit.xml
//!
//! The skeleton uses only `std` — no `serde_yaml` / `serde_json` —
//! so CI does not need to download any extra crates.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

// ---------------------------------------------------------------------------
// Minimal Value type — we never need more than bool/int/float/string/null/
// vec/map for this YAML subset.
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
enum Value {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    List(Vec<Value>),
}

impl Value {
    fn as_str(&self) -> Option<&str> {
        if let Value::Str(s) = self { Some(s) } else { None }
    }
    fn as_i64(&self) -> Option<i64> {
        if let Value::Int(i) = self { Some(*i) } else { None }
    }
    fn as_map(&self) -> Option<&BTreeMap<String, Value>> {
        // We use Vec<(String, Value)> for maps to preserve insertion order
        // via the .0 field; for as_map we just expose a thin view.
        None
    }
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn parse_scalar(v: &str) -> Value {
    let v = v.trim();
    if v.is_empty() {
        return Value::Null;
    }
    let low = v.to_ascii_lowercase();
    if low == "true" { return Value::Bool(true); }
    if low == "false" { return Value::Bool(false); }
    if low == "null" || low == "~" { return Value::Null; }
    if (v.starts_with('"') && v.ends_with('"'))
        || (v.starts_with('\'') && v.ends_with('\''))
    {
        return Value::Str(v[1..v.len() - 1].to_string());
    }
    if v.starts_with('[') && v.ends_with(']') {
        let inner = v[1..v.len() - 1].trim();
        if inner.is_empty() { return Value::List(vec![]); }
        return Value::List(inner.split(',').map(|p| parse_scalar(p.trim())).collect());
    }
    if let Ok(i) = v.parse::<i64>() { return Value::Int(i); }
    if let Ok(f) = v.parse::<f64>() { return Value::Float(f); }
    Value::Str(v.to_string())
}

/// Block-style YAML loader for the shape used by vbp_suite.yaml.
fn load_yaml(path: &PathBuf) -> (String, Vec<Vec<(String, Value)>>) {
    let raw = fs::read_to_string(path).expect("read suite");
    let mut top: Vec<(String, Value)> = Vec::new();
    let mut tests: Vec<Vec<(String, Value)>> = Vec::new();
    let lines: Vec<&str> = raw.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let s = line.trim();
        if s.is_empty() || s.starts_with('#') { i += 1; continue; }
        let indent = line.len() - line.trim_start().len();
        if s.starts_with("- ") && indent == 2 {
            let mut cur: Vec<(String, Value)> = Vec::new();
            let first = s[2..].trim();
            if let Some(colon) = first.find(':') {
                cur.push((
                    first[..colon].trim().to_string(),
                    parse_scalar(first[colon + 1..].trim()),
                ));
            }
            i += 1;
            while i < lines.len() {
                let nx = lines[i];
                if nx.trim().is_empty() { i += 1; continue; }
                let stripped = nx.trim_start();
                let ix = nx.len() - stripped.len();
                if ix == 2 && stripped.starts_with("- ") { break; }
                if ix == 0 && !stripped.is_empty() { break; }
                if let Some(colon) = stripped.find(':') {
                    cur.push((
                        stripped[..colon].trim().to_string(),
                        parse_scalar(stripped[colon + 1..].trim()),
                    ));
                }
                i += 1;
            }
            tests.push(cur);
            continue;
        }
        if indent == 0 && s.contains(':') {
            let colon = s.find(':').unwrap();
            top.push((
                s[..colon].trim().to_string(),
                parse_scalar(s[colon + 1..].trim()),
            ));
        }
        i += 1;
    }
    let suite_name = top
        .iter()
        .find(|(k, _)| k == "suite")
        .and_then(|(_, v)| v.as_str())
        .unwrap_or("vbp-conformance-v1")
        .to_string();
    (suite_name, tests)
}

fn get<'a>(kv: &'a [(String, Value)], key: &str) -> Option<&'a Value> {
    kv.iter().find(|(k, _)| k == key).map(|(_, v)| v)
}

#[derive(Clone)]
struct Outcome {
    id: i64,
    name: String,
    category: String,
    status: String,
    message: String,
    duration: f64,
}

fn run_test(t: &Vec<(String, Value)>) -> Outcome {
    let id = get(t, "id").and_then(Value::as_i64).unwrap_or(0);
    let name = get(t, "name").and_then(Value::as_str).unwrap_or("unknown").to_string();
    let category = get(t, "category").and_then(Value::as_str).unwrap_or("unknown").to_string();
    let start = Instant::now();
    Outcome {
        id,
        name,
        category,
        status: "skip".to_string(),
        message: "Rust harness: skeleton — no test cases driven end-to-end (TODO: port vbp_harness.go to rust)".to_string(),
        duration: start.elapsed().as_secs_f64(),
    }
}

fn write_junit(outcomes: &[Outcome], out_path: &PathBuf, suite_name: &str) {
    let mut by_cat: BTreeMap<String, Vec<Outcome>> = BTreeMap::new();
    for o in outcomes {
        by_cat.entry(o.category.clone()).or_default().push(o.clone());
    }
    let mut f = fs::File::create(out_path).expect("create out");
    writeln!(f, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>").unwrap();
    writeln!(f, "<testsuites>").unwrap();
    for (cat, oo) in &by_cat {
        let fails = oo.iter().filter(|o| o.status == "fail").count();
        let skips = oo.iter().filter(|o| o.status == "skip").count();
        let errs = oo.iter().filter(|o| o.status == "error").count();
        let total_dur: f64 = oo.iter().map(|o| o.duration).sum();
        writeln!(
            f, "  <testsuite name=\"{}\" tests=\"{}\" failures=\"{}\" skipped=\"{}\" errors=\"{}\" time=\"{:.3}\">",
            xml_escape(cat), oo.len(), fails, skips, errs, total_dur
        ).unwrap();
        for o in oo {
            writeln!(f, "    <testcase classname=\"{}\" name=\"{}\" time=\"{:.3}\">",
                xml_escape(suite_name),
                xml_escape(&format!("{} {}", o.id, o.name)),
                o.duration).unwrap();
            match o.status.as_str() {
                "fail"  => writeln!(f, "      <failure>{}</failure>", xml_escape(&o.message)).unwrap(),
                "skip"  => writeln!(f, "      <skipped>{}</skipped>", xml_escape(&o.message)).unwrap(),
                "error" => writeln!(f, "      <error>{}</error>", xml_escape(&o.message)).unwrap(),
                _ => {}
            }
            writeln!(f, "    </testcase>").unwrap();
        }
        writeln!(f, "  </testsuite>").unwrap();
    }
    writeln!(f, "</testsuites>").unwrap();
}

fn main() -> ExitCode {
    let mut suite: PathBuf = PathBuf::from("conformance/vbp_suite.yaml");
    let mut out: PathBuf = PathBuf::from("vbp-conformance-rust.junit.xml");
    let mut cat: String = String::new();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--suite"    => { suite = PathBuf::from(&args[i+1]); i += 2; }
            "--addr"     => { i += 2; }
            "--out"      => { out = PathBuf::from(&args[i+1]); i += 2; }
            "--user"     => { i += 2; }
            "--pass"     => { i += 2; }
            "--category" => { cat = args[i+1].clone(); i += 2; }
            _ => { i += 1; }
        }
    }
    if !suite.exists() {
        eprintln!("ERROR: suite file not found: {}", suite.display());
        return ExitCode::from(2);
    }
    let (suite_name, mut tests) = load_yaml(&suite);
    if !cat.is_empty() {
        tests.retain(|t| {
            get(t, "category").and_then(Value::as_str).map(|c| c == cat).unwrap_or(false)
        });
    }
    let outcomes: Vec<Outcome> = tests.iter().map(run_test).collect();
    write_junit(&outcomes, &out, &suite_name);
    let pass_n = outcomes.iter().filter(|o| o.status == "pass").count();
    let fail_n = outcomes.iter().filter(|o| o.status == "fail").count();
    let skip_n = outcomes.iter().filter(|o| o.status == "skip").count();
    let err_n  = outcomes.iter().filter(|o| o.status == "error").count();
    println!("VBP v1 conformance (Rust skeleton)");
    println!("  tests:  {}", outcomes.len());
    println!("  pass:   {}", pass_n);
    println!("  fail:   {}", fail_n);
    println!("  skip:   {}", skip_n);
    println!("  error:  {}", err_n);
    println!("  report: {}", out.display());
    if fail_n + err_n > 0 { ExitCode::from(1) } else { ExitCode::from(0) }
}
