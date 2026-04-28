<?php

declare(strict_types=1);

namespace VedaDB;

class VedaException extends \RuntimeException {}

class ConnectionException extends VedaException {}

class QueryException extends VedaException {}

class TimeoutException extends VedaException {}

class AuthException extends VedaException {}
