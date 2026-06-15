#!/usr/bin/env ruby
# frozen_string_literal: true
#
# vbp_harness.rb — VBP v1 conformance skeleton harness (Ruby).
#
# Loads conformance/vbp_suite.yaml using only the Ruby stdlib
# (a hand-rolled block-style YAML parser; we deliberately do NOT
# use the 'psych' gem, although Ruby ships with it, because we
# want the harness to be runnable in any environment with a bare
# `ruby` interpreter). Iterates every test, emits a JUnit XML
# report, and SKIPs all tests. Exit code 0 on success, 1 on any
# FAIL/ERROR.
#
# Usage:
#   ruby vbp_harness.rb --suite ../../vbp_suite.yaml \
#                       --out   ./vbp-conformance-ruby.junit.xml

require 'optparse'
require 'fileutils'
require 'time'

# ---------------------------------------------------------------------------
# Tiny block-style YAML loader (stdlib-only).
# Mirrors the structure used by the other 7 harnesses' loaders.
# ---------------------------------------------------------------------------

def parse_scalar(v)
  v = v.to_s.strip
  return nil if v.empty?
  low = v.downcase
  return true  if low == 'true'
  return false if low == 'false'
  return nil   if low == 'null' || low == '~'
  return v[1..-2] if (v.start_with?('"') && v.end_with?('"')) ||
                     (v.start_with?("'") && v.end_with?("'"))
  if v.start_with?('[') && v.end_with?(']')
    inner = v[1..-2].strip
    return [] if inner.empty?
    return inner.split(',').map { |p| parse_scalar(p.strip) }
  end
  return Integer(v) if v =~ /\A-?\d+\z/
  return Float(v)   if v =~ /\A-?\d+\.\d+\z/
  v
end

def leading_spaces(s)
  s.length - s.lstrip.length
end

def load_yaml(path)
  lines = File.readlines(path)
  out = {}
  tests = []
  i = 0
  while i < lines.length
    line = lines[i]
    s = line.strip
    if s.empty? || s.start_with?('#')
      i += 1
      next
    end
    indent = leading_spaces(line)
    if s.start_with?('- ') && indent == 2
      cur = {}
      first = s[2..].strip
      if first.include?(':')
        k, v = first.split(':', 2)
        cur[k.strip] = parse_scalar(v)
      end
      i += 1
      while i < lines.length
        nx = lines[i]
        if nx.strip.empty?
          i += 1
          next
        end
        stripped = nx.lstrip
        ix = nx.length - stripped.length
        break if ix == 2 && stripped.start_with?('- ')
        break if ix == 0 && !stripped.empty?
        if stripped.include?(':')
          k, v = stripped.split(':', 2)
          cur[k.strip] = parse_scalar(v)
        end
        i += 1
      end
      tests << cur
      next
    end
    if indent == 0 && s.include?(':')
      k, v = s.split(':', 2)
      out[k.strip] = parse_scalar(v)
    end
    i += 1
  end
  out['tests'] = tests unless tests.empty?
  out
end

# ---------------------------------------------------------------------------
# JUnit emit
# ---------------------------------------------------------------------------

def xml_escape(s)
  s.to_s
   .gsub('&', '&amp;')
   .gsub('<', '&lt;')
   .gsub('>', '&gt;')
   .gsub('"', '&quot;')
   .gsub("'", '&apos;')
end

def write_junit(outcomes, out_path, suite_name)
  by_cat = outcomes.group_by { |o| o[:category] }
  File.open(out_path, 'w') do |f|
    f.puts '<?xml version="1.0" encoding="UTF-8"?>'
    f.puts '<testsuites>'
    by_cat.keys.sort.each do |cat|
      oo = by_cat[cat]
      fails = oo.count { |o| o[:status] == 'fail' }
      skips = oo.count { |o| o[:status] == 'skip' }
      errs  = oo.count { |o| o[:status] == 'error' }
      total_dur = oo.sum { |o| o[:duration] }
      f.puts "  <testsuite name=\"#{xml_escape(cat)}\" tests=\"#{oo.length}\" failures=\"#{fails}\" skipped=\"#{skips}\" errors=\"#{errs}\" time=\"#{format('%.3f', total_dur)}\">"
      oo.each do |o|
        f.puts "    <testcase classname=\"#{xml_escape(suite_name)}\" name=\"#{xml_escape("#{o[:id]} #{o[:name]}")}\" time=\"#{format('%.3f', o[:duration])}\">"
        f.puts "      <failure>#{xml_escape(o[:message])}</failure>"  if o[:status] == 'fail'
        f.puts "      <skipped>#{xml_escape(o[:message])}</skipped>"  if o[:status] == 'skip'
        f.puts "      <error>#{xml_escape(o[:message])}</error>"      if o[:status] == 'error'
        f.puts '    </testcase>'
      end
      f.puts '  </testsuite>'
    end
    f.puts '</testsuites>'
  end
end

# ---------------------------------------------------------------------------
# Test runner (skeleton — all SKIP)
# ---------------------------------------------------------------------------

def run_test(t)
  {
    id:       t['id'] || 0,
    name:     t['name'] || 'unknown',
    category: t['category'] || 'unknown',
    status:   'skip',
    message:  'Ruby harness: skeleton — no test cases driven end-to-end (TODO: port vbp_harness.go to ruby)',
    duration: 0.0,
  }
end

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

opts = {
  suite: 'conformance/vbp_suite.yaml',
  addr:  '127.0.0.1:6380',
  out:   'vbp-conformance-ruby.junit.xml',
  user:  'admin',
  pass:  'TestPassword123!',
  cat:   '',
}
OptionParser.new do |o|
  o.on('--suite S')    { |v| opts[:suite] = v }
  o.on('--addr A')     { |v| opts[:addr] = v }
  o.on('--out F')      { |v| opts[:out] = v }
  o.on('--user U')     { |v| opts[:user] = v }
  o.on('--pass P')     { |v| opts[:pass] = v }
  o.on('--category C') { |v| opts[:cat] = v }
end.parse!

unless File.exist?(opts[:suite])
  warn "ERROR: suite file not found: #{opts[:suite]}"
  exit 2
end

data = load_yaml(opts[:suite])
tests = data['tests'] || []
tests = tests.select { |t| t['category'] == opts[:cat] } unless opts[:cat].empty?
suite_name = data['suite'] || 'vbp-conformance-v1'

outcomes = tests.map { |t| run_test(t) }
write_junit(outcomes, opts[:out], suite_name)

pass_n = outcomes.count { |o| o[:status] == 'pass' }
fail_n = outcomes.count { |o| o[:status] == 'fail' }
skip_n = outcomes.count { |o| o[:status] == 'skip' }
err_n  = outcomes.count { |o| o[:status] == 'error' }
puts 'VBP v1 conformance (Ruby skeleton)'
puts "  tests:  #{outcomes.length}"
puts "  pass:   #{pass_n}"
puts "  fail:   #{fail_n}"
puts "  skip:   #{skip_n}"
puts "  error:  #{err_n}"
puts "  report: #{opts[:out]}"
exit(fail_n + err_n > 0 ? 1 : 0)
