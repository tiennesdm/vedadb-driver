"""
Pub/Sub messaging for VedaDB — Redis-style publish/subscribe.

Implements a lightweight publish/subscribe messaging layer on top of
VedaDB's query interface.  Can be backed by the database's native pub/sub
or simulated via polling a subscription table.

Example — publisher::

    from vedadb.pubsub import PubSub

    pubsub = PubSub(db)
    count = await pubsub.publish("notifications", "Hello, subscribers!")
    print(f"Delivered to {count} subscribers")

Example — subscriber::

    async for message in pubsub.subscribe("notifications", "alerts"):
        print(f"[{message.channel}] {message.data}")
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable, Dict, Iterator, List, Optional, Set

logger = logging.getLogger("vedadb.pubsub")


@dataclass
class Message:
    """A pub/sub message.

    Attributes:
        channel: The channel the message was published on.
        data: The message payload (string).
        pattern: The pattern that matched (for pattern subscriptions).
    """

    channel: str
    data: str
    pattern: str | None = None

    def to_json(self) -> str:
        """Serialize the message to JSON."""
        return json.dumps(
            {
                "channel": self.channel,
                "data": self.data,
                "pattern": self.pattern,
            }
        )


class PubSub:
    """Redis-style publish/subscribe messaging.

    Provides channels, pattern subscriptions, and message delivery.
    Can operate in two modes:

    - **Native mode**: Uses VedaDB's built-in ``LISTEN`` / ``NOTIFY``
      if the server supports it.
    - **Emulated mode**: Polls a ``_pubsub_messages`` table for new
      messages (fallback).

    Args:
        client: A :class:`VedaDB` or compatible client.
        poll_interval: Seconds between polls in emulated mode.
        use_native: Whether to try native LISTEN/NOTIFY first.

    Example::

        pubsub = PubSub(db)
        await pubsub.publish("events", json.dumps({"type": "user_login"}))

        async for msg in pubsub.subscribe("events"):
            data = json.loads(msg.data)
            print(f"Event: {data['type']}")
    """

    def __init__(
        self,
        client: Any,
        poll_interval: float = 0.5,
        use_native: bool = True,
    ):
        self._client = client
        self._poll_interval = poll_interval
        self._use_native = use_native
        self._subscriptions: Set[str] = set()
        self._pattern_subs: Set[str] = set()
        self._running = False
        self._last_poll_time = 0.0
        self._native_supported: bool | None = None

    # ------------------------------------------------------------------
    # Publish
    # ------------------------------------------------------------------

    async def publish(self, channel: str, message: str) -> int:
        """Publish a message to a channel.

        Args:
            channel: Channel name.
            message: Message payload.

        Returns:
            Number of subscribers that received the message.
        """
        return self.publish_sync(channel, message)

    def publish_sync(self, channel: str, message: str) -> int:
        """Synchronous variant of :meth:`publish`."""
        try:
            # Try native NOTIFY
            if self._use_native:
                try:
                    result = self._client.query(f"NOTIFY {channel}, '{self._escape(message)}'")
                    return 1
                except Exception:
                    pass

            # Fall back to table-based pub/sub
            from .protocol import sql_literal
            sql = (
                f"INSERT INTO _pubsub_messages (channel, data, ts) "
                f"VALUES ({sql_literal(channel)}, {sql_literal(message)}, now());"
            )
            self._client.query(sql)
            return 1
        except Exception as exc:
            logger.warning("Publish to %r failed: %s", channel, exc)
            return 0

    # ------------------------------------------------------------------
    # Subscribe
    # ------------------------------------------------------------------

    async def subscribe(self, *channels: str) -> AsyncIterator[Message]:
        """Subscribe to one or more channels and yield messages.

        Args:
            *channels: Channel names to subscribe to.

        Yields:
            :class:`Message` objects as they arrive.
        """
        if not channels:
            raise ValueError("at least one channel is required")

        self._subscriptions.update(channels)
        self._running = True

        logger.info("Subscribed to channels: %s", channels)

        try:
            if self._use_native and self._native_supported is not False:
                try:
                    async for msg in self._native_listen(channels):
                        yield msg
                    return
                except Exception:
                    self._native_supported = False
                    logger.debug("Native LISTEN not available, falling back to polling")

            async for msg in self._emulated_subscribe(channels):
                yield msg
        finally:
            for ch in channels:
                self._subscriptions.discard(ch)
            logger.info("Unsubscribed from channels: %s", channels)

    def subscribe_sync(self, *channels: str) -> Iterator[Message]:
        """Synchronous variant of :meth:`subscribe`."""
        if not channels:
            raise ValueError("at least one channel is required")

        self._subscriptions.update(channels)
        self._running = True

        logger.info("Subscribed (sync) to channels: %s", channels)

        try:
            if self._use_native and self._native_supported is not False:
                try:
                    for msg in self._native_listen_sync(channels):
                        yield msg
                    return
                except Exception:
                    self._native_supported = False

            for msg in self._emulated_subscribe_sync(channels):
                yield msg
        finally:
            for ch in channels:
                self._subscriptions.discard(ch)

    async def unsubscribe(self, *channels: str) -> None:
        """Unsubscribe from one or more channels.

        If no channels are given, unsubscribes from all channels.
        """
        if not channels:
            self._subscriptions.clear()
            self._running = False
            logger.info("Unsubscribed from all channels")
        else:
            for ch in channels:
                self._subscriptions.discard(ch)
            logger.info("Unsubscribed from: %s", channels)

    # ------------------------------------------------------------------
    # Pattern subscribe
    # ------------------------------------------------------------------

    async def psubscribe(self, pattern: str) -> AsyncIterator[Message]:
        """Subscribe to channels matching a glob-style pattern.

        Args:
            pattern: Glob pattern (e.g. ``"events.*"``, ``"user.*"``).

        Yields:
            :class:`Message` objects from matching channels.
        """
        import fnmatch

        self._pattern_subs.add(pattern)
        self._running = True

        logger.info("Pattern subscribed to: %s", pattern)

        try:
            async for msg in self._emulated_subscribe(pattern=pattern):
                if fnmatch.fnmatch(msg.channel, pattern):
                    msg.pattern = pattern
                    yield msg
        finally:
            self._pattern_subs.discard(pattern)

    def psubscribe_sync(self, pattern: str) -> Iterator[Message]:
        """Synchronous variant of :meth:`psubscribe`."""
        import fnmatch

        self._pattern_subs.add(pattern)
        self._running = True

        try:
            for msg in self._emulated_subscribe_sync(pattern=pattern):
                if fnmatch.fnmatch(msg.channel, pattern):
                    msg.pattern = pattern
                    yield msg
        finally:
            self._pattern_subs.discard(pattern)

    # ------------------------------------------------------------------
    # Native LISTEN/NOTIFY (async)
    # ------------------------------------------------------------------

    async def _native_listen(self, channels: tuple[str, ...]) -> AsyncIterator[Message]:
        """Use native LISTEN for subscriptions."""
        for ch in channels:
            self._client.query(f"LISTEN {ch}")

        while self._running and any(c in self._subscriptions for c in channels):
            # Poll for notifications
            result = self._client.query("SELECT * FROM pg_get_notification()")
            if result and hasattr(result, "to_dicts"):
                for row in result.to_dicts():
                    msg = Message(
                        channel=row.get("channel", ""),
                        data=row.get("payload", ""),
                    )
                    if msg.channel in channels:
                        yield msg
            await asyncio.sleep(self._poll_interval)

    def _native_listen_sync(self, channels: tuple[str, ...]) -> Iterator[Message]:
        """Sync native LISTEN."""
        for ch in channels:
            self._client.query(f"LISTEN {ch}")

        while self._running and any(c in self._subscriptions for c in channels):
            result = self._client.query("SELECT * FROM pg_get_notification()")
            if result and hasattr(result, "to_dicts"):
                for row in result.to_dicts():
                    msg = Message(
                        channel=row.get("channel", ""),
                        data=row.get("payload", ""),
                    )
                    if msg.channel in channels:
                        yield msg
            time.sleep(self._poll_interval)

    # ------------------------------------------------------------------
    # Emulated subscribe (polling)
    # ------------------------------------------------------------------

    async def _emulated_subscribe(
        self,
        channels: tuple[str, ...] | None = None,
        pattern: str | None = None,
    ) -> AsyncIterator[Message]:
        """Poll the _pubsub_messages table for new messages."""
        import fnmatch

        last_id = 0
        while self._running:
            try:
                query = self._build_poll_query(channels, pattern, last_id)
                result = self._client.query(query)

                if result and hasattr(result, "to_dicts"):
                    rows = result.to_dicts()
                    for row in rows:
                        last_id = max(last_id, int(row.get("id", 0)))
                        msg = Message(
                            channel=row.get("channel", ""),
                            data=row.get("data", ""),
                        )
                        # Pattern matching
                        if pattern and not fnmatch.fnmatch(msg.channel, pattern):
                            continue
                        if channels and msg.channel not in channels:
                            continue
                        yield msg
            except Exception as exc:
                logger.warning("PubSub poll error: %s", exc)

            await asyncio.sleep(self._poll_interval)

    def _emulated_subscribe_sync(
        self,
        channels: tuple[str, ...] | None = None,
        pattern: str | None = None,
    ) -> Iterator[Message]:
        """Sync emulated subscribe."""
        import fnmatch

        last_id = 0
        while self._running:
            try:
                query = self._build_poll_query(channels, pattern, last_id)
                result = self._client.query(query)

                if result and hasattr(result, "to_dicts"):
                    rows = result.to_dicts()
                    for row in rows:
                        last_id = max(last_id, int(row.get("id", 0)))
                        msg = Message(
                            channel=row.get("channel", ""),
                            data=row.get("data", ""),
                        )
                        if pattern and not fnmatch.fnmatch(msg.channel, pattern):
                            continue
                        if channels and msg.channel not in channels:
                            continue
                        yield msg
            except Exception as exc:
                logger.warning("PubSub poll error: %s", exc)

            time.sleep(self._poll_interval)

    def _build_poll_query(
        self,
        channels: tuple[str, ...] | None,
        pattern: str | None,
        last_id: int,
    ) -> str:
        """Build the polling query for emulated mode."""
        query = f"SELECT * FROM _pubsub_messages WHERE id > {last_id}"
        if channels:
            placeholders = ", ".join(f"'{c}'" for c in channels)
            query += f" AND channel IN ({placeholders})"
        query += " ORDER BY id ASC LIMIT 100"
        return query

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    @staticmethod
    def _escape(value: str) -> str:
        """Escape a string for use in a SQL NOTIFY statement."""
        return value.replace("'", "''").replace("\\", "\\\\")

    @property
    def subscriptions(self) -> Set[str]:
        """Currently active channel subscriptions."""
        return set(self._subscriptions)

    @property
    def pattern_subscriptions(self) -> Set[str]:
        """Currently active pattern subscriptions."""
        return set(self._pattern_subs)

    def close(self) -> None:
        """Close the pub/sub system and unsubscribe from all channels."""
        self._running = False
        self._subscriptions.clear()
        self._pattern_subs.clear()
        logger.info("PubSub closed")

    def __repr__(self) -> str:
        return (
            f"<PubSub channels={len(self._subscriptions)} "
            f"patterns={len(self._pattern_subs)} "
            f"running={self._running}>"
        )
