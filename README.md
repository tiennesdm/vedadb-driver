# VedaDB Drivers

> **Official Language Drivers for VedaDB**
> Connect to VedaDB from any programming language.

## Overview

VedaDB provides official drivers for 8+ programming languages. Each driver supports all 7 data models with a unified API.

## Supported Languages

| Language | Package | Version | Status |
|----------|---------|---------|--------|
| Python | `pip install vedadb` | 1.0.0 | Ready |
| Node.js | `npm install @vedadb/driver` | 1.0.0 | Ready |
| Go | `go get github.com/vedadb/go-driver` | 1.0.0 | Ready |
| Java | `gradle: io.vedadb:driver:1.0.0` | 1.0.0 | Ready |
| Rust | `cargo add vedadb` | 1.0.0 | Ready |
| C# | `dotnet add package VedaDB.Driver` | 1.0.0 | Ready |
| Ruby | `gem install vedadb` | 1.0.0 | Ready |
| PHP | `composer require vedadb/driver` | 1.0.0 | Ready |

## Quick Start

### Python
```python
from vedadb import VedaDBClient

client = VedaDBClient("http://localhost:8080", api_key="your-key")

# SQL
result = client.sql.query("SELECT * FROM users WHERE age > 25")

# Vector Search
result = client.vector.search("products_embeddings", query_vector=[0.1,0.2,...], top_k=5)

# Graph
result = client.graph.traverse("friends", from_node="user:123", depth=3)

# Cache
client.cache.set("session:abc", {"data": 1}, ttl=3600)
```

### Node.js
```javascript
const { VedaDBClient } = require('@vedadb/driver');

const client = new VedaDBClient('http://localhost:8080', { apiKey: 'your-key' });

// SQL
const result = await client.sql.query('SELECT * FROM users WHERE age > 25');

// Vector
const vectors = await client.vector.search('products', [0.1, 0.2], { topK: 5 });
```

### Go
```go
import "github.com/vedadb/go-driver"

client := vedadb.NewClient("http://localhost:8080")
client.SetAPIKey("your-key")

result, _ := client.SQL.Query("SELECT * FROM users")
```

## Driver Features

- Connection pooling
- Automatic retries
- Query timeout
- Result streaming
- Transaction support
- Type-safe results

## Related Repos

| Repo | Purpose |
|------|---------|
| [vedadb-driver-demos](https://github.com/tiennesdm/vedadb-driver-demos) | Demo projects per language |
| [vedadb-server-code](https://github.com/tiennesdm/vedadb-server-code) | Core database engine |
| [vedadb-workbench](https://github.com/tiennesdm/vedadb-workbench) | Admin UI |

## License

Apache 2.0
