Gem::Specification.new do |s|
  s.name        = "vedadb"
  s.version     = "0.2.0"
  s.summary     = "Official Ruby driver for VedaDB"
  s.description = "Ruby client driver for VedaDB - The Multi-Model Database Engine. " \
                  "Supports SQL, NoSQL, cache, search, and more over a simple TCP protocol."
  s.authors     = ["VedaDB Contributors"]
  s.homepage    = "https://github.com/vedadb/vedadb"
  s.license     = "Apache-2.0"
  s.metadata    = {
    "source_code_uri"   => "https://github.com/vedadb/vedadb/tree/main/drivers/ruby",
    "bug_tracker_uri"   => "https://github.com/vedadb/vedadb/issues",
    "changelog_uri"     => "https://github.com/vedadb/vedadb/blob/main/drivers/ruby/CHANGELOG.md",
    "rubygems_mfa_required" => "true",
  }

  s.required_ruby_version = ">= 3.0"
  s.files       = Dir["lib/**/*.rb", "LICENSE", "README.md"]
  s.require_paths = ["lib"]
end
