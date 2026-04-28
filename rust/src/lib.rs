//! # VedaDB
//!
//! Official Rust driver for VedaDB - The Multi-Model Database Engine.
//!
//! ## Quick Start
//!
//! ```no_run
//! use vedadb::Client;
//!
//! fn main() -> vedadb::Result<()> {
//!     let mut db = Client::connect("localhost", 6380)?;
//!
//!     db.exec("CREATE TABLE users (id INT, name TEXT, age INT);")?;
//!     db.insert("users", &[("id", &1), ("name", &"Alice"), ("age", &30)])?;
//!
//!     let result = db.query("SELECT * FROM users;")?;
//!     for row in result.to_maps() {
//!         println!("{:?}", row);
//!     }
//!
//!     Ok(())
//! }
//! ```

pub mod client;
pub mod error;
pub mod pool;
pub mod result;

pub use client::{Client, Config};
pub use error::{Result, VedaError};
pub use pool::Pool;
pub use result::VedaResult;
