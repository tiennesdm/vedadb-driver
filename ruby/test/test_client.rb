# test_client.rb — Core driver tests for VedaDB Ruby driver
require 'minitest/autorun'
require 'json'

# Mock server for testing
class MockVedaServer
  attr_reader :request_log, :call_count

  def initialize
    @responses = []
    @request_log = []
    @call_count = 0
    @failure_count = 0
    @failure_threshold = 0
  end

  def add_response(status_code: 200, body: {})
    @responses << { status_code: status_code, body: body }
  end

  def set_failure_sequence(count, status_code: 503)
    @failure_threshold = count
    count.times { @responses << { status_code: status_code, body: { 'error' => 'temporary error' } } }
  end

  def handle_request(method:, url:, body: nil, headers: {})
    @call_count += 1
    @request_log << { method: method, url: url, body: body, headers: headers }

    resp = @responses.shift || { status_code: 200, body: { 'result' => nil } }

    if resp[:status_code] >= 400
      raise VedaConnectionError, "HTTP #{resp[:status_code]}: #{resp[:body]['error']}"
    end

    resp[:body]
  end

  def reset
    @responses = []
    @request_log = []
    @call_count = 0
  end
end

# VedaClient implementation
class VedaClient
  attr_reader :endpoint, :timeout, :max_retries, :retry_delay, :auth_token
  attr_accessor :closed

  def initialize(endpoint:, timeout: 10, max_retries: 3, retry_delay: 0.1, auth_token: nil, transport: nil)
    @endpoint = endpoint.chomp('/')
    @timeout = timeout
    @max_retries = max_retries
    @retry_delay = retry_delay
    @auth_token = auth_token
    @transport = transport
    @closed = false
    @healthy = false
  end

  def connect
    @healthy = true
    self
  end

  def query(sql, *params)
    raise VedaClientError, 'Client is closed' if @closed

    body = { 'sql' => sql, 'params' => params }
    response = send_with_retry(body)
    raise VedaClientError, response['error'] if response['error']
    response['result'] || []
  end

  def execute(sql, *params)
    raise VedaClientError, 'Client is closed' if @closed

    body = { 'sql' => sql, 'params' => params }
    response = send_with_retry(body)
    raise VedaClientError, response['error'] if response['error']
    ExecuteResult.new(response['result'] || {})
  end

  def close
    @closed = true
  end

  def healthy?
    @healthy && !@closed
  end

  private

  def send_with_retry(body)
    last_error = nil
    delay = @retry_delay

    (0..@max_retries).each do |attempt|
      sleep(delay * (2 ** (attempt - 1))) if attempt > 0

      begin
        return @transport.call(method: 'POST', url: "#{@endpoint}/query", body: body)
      rescue VedaConnectionError => e
        last_error = e
        raise unless e.message =~ /5\d\d/
      end
    end

    raise last_error || VedaClientError.new('Request failed')
  end
end

class ExecuteResult
  attr_reader :rows_affected, :last_insert_id

  def initialize(result)
    @rows_affected = result['rowsAffected'] || result['rows_affected'] || 0
    @last_insert_id = result['lastInsertId'] || result['last_insert_id']
  end
end

class VedaClientError < StandardError; end
class VedaConnectionError < StandardError; end

# Tests
class TestClient < Minitest::Test
  def setup
    @mock_server = MockVedaServer.new
    @client = VedaClient.new(
      endpoint: 'http://localhost:8080',
      transport: ->(method:, url:, body:) { @mock_server.handle_request(method: method, url: url, body: body) }
    )
  end

  def teardown
    @client.close if @client && !@client.closed
  end

  # Connection tests
  def test_connect_success
    @client.connect
    assert @client.healthy?
  end

  def test_configure_with_options
    client = VedaClient.new(
      endpoint: 'http://db:9999',
      timeout: 5,
      max_retries: 5,
      retry_delay: 0.5
    )
    assert_equal 'http://db:9999', client.endpoint
    assert_equal 5, client.timeout
    assert_equal 5, client.max_retries
    assert_equal 0.5, client.retry_delay
  end

  def test_connect_with_auth
    client = VedaClient.new(endpoint: 'http://localhost:8080', auth_token: 'test-token-123')
    assert_equal 'test-token-123', client.auth_token
  end

  # Query tests
  def test_query_single_row
    @mock_server.add_response(body: { 'result' => [{ 'id' => 1, 'name' => 'Alice' }] })
    result = @client.query('SELECT * FROM users WHERE id = ?', 1)
    assert_equal 1, result.length
    assert_equal 'Alice', result[0]['name']
  end

  def test_query_multiple_rows
    @mock_server.add_response(body: {
      'result' => [
        { 'id' => 1, 'name' => 'Alice' },
        { 'id' => 2, 'name' => 'Bob' },
        { 'id' => 3, 'name' => 'Charlie' }
      ]
    })
    result = @client.query('SELECT * FROM users')
    assert_equal 3, result.length
  end

  def test_query_empty_result
    @mock_server.add_response(body: { 'result' => [] })
    result = @client.query('SELECT * FROM empty_table')
    assert_empty result
  end

  def test_query_server_error
    @mock_server.set_failure_sequence(1, status_code: 500)
    assert_raises(VedaClientError) { @client.query('SELECT * FROM users') }
  end

  def test_query_application_error
    @mock_server.add_response(body: { 'error' => 'syntax error at position 14' })
    error = assert_raises(VedaClientError) { @client.query('INVALID SQL') }
    assert_match(/syntax error/, error.message)
  end

  # Execute tests
  def test_execute_insert
    @mock_server.add_response(body: { 'result' => { 'rowsAffected' => 1, 'lastInsertId' => 42 } })
    result = @client.execute('INSERT INTO users (name) VALUES (?)', 'Alice')
    assert_equal 1, result.rows_affected
    assert_equal 42, result.last_insert_id
  end

  def test_execute_update
    @mock_server.add_response(body: { 'result' => { 'rowsAffected' => 5 } })
    result = @client.execute('UPDATE users SET active = false')
    assert_equal 5, result.rows_affected
  end

  def test_execute_delete
    @mock_server.add_response(body: { 'result' => { 'rowsAffected' => 1 } })
    result = @client.execute('DELETE FROM users WHERE id = ?', 99)
    assert_equal 1, result.rows_affected
  end

  # Close tests
  def test_close
    @client.close
    assert @client.closed
  end

  def test_close_idempotent
    @client.close
    assert_nothing_raised { @client.close }
  end

  def test_query_after_close
    @client.close
    error = assert_raises(VedaClientError) { @client.query('SELECT 1') }
    assert_match(/closed/, error.message)
  end

  def test_execute_after_close
    @client.close
    error = assert_raises(VedaClientError) { @client.execute('INSERT INTO t VALUES (1)') }
    assert_match(/closed/, error.message)
  end
end
