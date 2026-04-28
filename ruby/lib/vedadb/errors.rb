# frozen_string_literal: true

module VedaDB
  class Error < StandardError; end
  class ConnectionError < Error; end
  class QueryError < Error; end
  class TimeoutError < Error; end
end
