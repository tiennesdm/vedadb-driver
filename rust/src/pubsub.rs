use std::collections::HashMap;
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::client::VedaConfig;
use crate::error::VedaError;
use crate::protocol::{async_protocol::AsyncProtocol, Command, Protocol, ResponsePayload};

/// A pub/sub message.
#[derive(Debug, Clone)]
pub struct Message {
    pub channel: String,
    pub payload: String,
    pub timestamp: u64,
}

/// Synchronous Pub/Sub client.
pub struct PubSub {
    config: VedaConfig,
    subscribers: Arc<Mutex<HashMap<String, Vec<mpsc::Sender<Message>>>>>,
    running: AtomicBool,
    listener_handle: Mutex<Option<thread::JoinHandle<()>>>,
}

impl PubSub {
    /// Create a new PubSub handle.
    pub fn new(config: VedaConfig) -> Self {
        PubSub {
            config,
            subscribers: Arc::new(Mutex::new(HashMap::new())),
            running: AtomicBool::new(false),
            listener_handle: Mutex::new(None),
        }
    }

    /// Subscribe to a channel.
    pub fn subscribe(&self, channel: &str) -> Result<mpsc::Receiver<Message>, VedaError> {
        let (tx, rx) = mpsc::channel::<Message>(1000);

        {
            let mut subs = self.subscribers.lock().unwrap();
            subs.entry(channel.to_string())
                .or_insert_with(Vec::new)
                .push(tx);
        }

        // If listener not running, start it
        if !self.running.load(Ordering::SeqCst) {
            self.start_listener()?;
        }

        // Send SUBSCRIBE command
        // In a real implementation, we'd send this over a dedicated connection
        Ok(rx)
    }

    /// Unsubscribe from a channel.
    pub fn unsubscribe(&self, channel: &str) {
        let mut subs = self.subscribers.lock().unwrap();
        subs.remove(channel);
    }

    /// Publish a message to a channel.
    pub fn publish(
        &self,
        client: &mut crate::client::VedaClient,
        channel: &str,
        message: &str,
    ) -> Result<usize, VedaError> {
        if let Some(protocol) = client.protocol() {
            let resp = protocol.send_command(&Command::Publish {
                channel: channel.to_string(),
                message: message.to_string(),
            })?;
            match resp.payload {
                ResponsePayload::Published { listeners, .. } => Ok(listeners),
                _ => Ok(0),
            }
        } else {
            Err(VedaError::Connection {
                message: "not connected".to_string(),
                host: None,
                port: None,
            })
        }
    }

    /// List active subscriptions.
    pub fn subscriptions(&self) -> Vec<String> {
        self.subscribers
            .lock()
            .unwrap()
            .keys()
            .cloned()
            .collect()
    }

    /// Stop the pub/sub listener.
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.listener_handle.lock().unwrap().take() {
            let _ = handle.join();
        }
    }

    fn start_listener(&self) -> Result<(), VedaError> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Ok(()); // Already running
        }

        let subscribers = Arc::clone(&self.subscribers);
        let config = self.config.clone();

        let handle = thread::spawn(move || {
            // Connect a dedicated listener
            let mut client = match crate::client::VedaClient::new(config) {
                Ok(c) => c,
                Err(_) => return,
            };
            if client.connect().is_err() {
                return;
            }

            // Listener loop - read messages from server
            // In a real implementation, this would parse pub/sub protocol messages
            loop {
                // Check if we should stop
                // Read from connection and dispatch to subscribers
                thread::sleep(Duration::from_millis(100));
            }
        });

        *self.listener_handle.lock().unwrap() = Some(handle);
        Ok(())
    }

    fn dispatch_message(&self, message: Message) {
        let subs = self.subscribers.lock().unwrap();
        if let Some(send_channels) = subs.get(&message.channel) {
            for tx in send_channels {
                let _ = tx.send(message.clone());
            }
        }
    }
}

impl Drop for PubSub {
    fn drop(&mut self) {
        self.stop();
    }
}

// ============== Async Pub/Sub ==============

/// Async Pub/Sub client using tokio channels.
#[cfg(feature = "tokio")]
pub struct AsyncPubSub {
    config: VedaConfig,
}

#[cfg(feature = "tokio")]
impl AsyncPubSub {
    /// Create a new async PubSub handle.
    pub fn new(config: VedaConfig) -> Self {
        AsyncPubSub { config }
    }

    /// Subscribe to a channel.
    pub async fn subscribe(
        &self,
        client: &mut crate::async_client::AsyncVedaClient,
        channel: &str,
    ) -> Result<tokio::sync::mpsc::Receiver<Message>, VedaError> {
        let (tx, rx) = tokio::sync::mpsc::channel::<Message>(1000);

        if let Some(protocol) = client.protocol_mut() {
            protocol
                .send_command(&Command::Subscribe {
                    channel: channel.to_string(),
                })
                .await?;
        }

        // Spawn listener task
        tokio::spawn(async move {
            // Listen for messages and forward to tx
            let _ = tx;
        });

        Ok(rx)
    }

    /// Unsubscribe from a channel.
    pub async fn unsubscribe(
        &self,
        client: &mut crate::async_client::AsyncVedaClient,
        channel: &str,
    ) -> Result<(), VedaError> {
        if let Some(protocol) = client.protocol_mut() {
            protocol
                .send_command(&Command::Unsubscribe {
                    channel: channel.to_string(),
                })
                .await?;
        }
        Ok(())
    }

    /// Publish a message.
    pub async fn publish(
        &self,
        client: &mut crate::async_client::AsyncVedaClient,
        channel: &str,
        message: &str,
    ) -> Result<usize, VedaError> {
        if let Some(protocol) = client.protocol_mut() {
            let resp = protocol
                .send_command(&Command::Publish {
                    channel: channel.to_string(),
                    message: message.to_string(),
                })
                .await?;
            match resp.payload {
                ResponsePayload::Published { listeners, .. } => Ok(listeners),
                _ => Ok(0),
            }
        } else {
            Err(VedaError::Connection {
                message: "not connected".to_string(),
                host: None,
                port: None,
            })
        }
    }
}
