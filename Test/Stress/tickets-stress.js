import http from 'k6/http';
import { check, sleep } from 'k6';
import { buildUrl, getAuthHeaders, loginAndGetToken, getTestOptions } from './helpers.js';

export const options = getTestOptions();

let token;

export function setup() {
  token = loginAndGetToken();
  return { token };
}

export default function (data) {
  const token = data.token;
  const headers = getAuthHeaders(token);

  // Test: Get user's tickets
  const ticketsRes = http.get(buildUrl('/api/Ticket/tickets-user'), { headers });
  const ticketsSuccess = check(ticketsRes, {
    'get tickets status is 200': (r) => r.status === 200,
    'get tickets has data': (r) => {
      const body = r.json();
      return body && body.tickets !== undefined;
    },
  });

  let ticketId = null;
  if (ticketsSuccess) {
    const ticketsBody = ticketsRes.json();
    if (ticketsBody.tickets && ticketsBody.tickets.length > 0) {
      ticketId = ticketsBody.tickets[0].id;
    }
  }

  // Test: Get ticket by ID
  if (ticketId) {
    const ticketRes = http.get(
      buildUrl(`/api/Ticket/tickets/${ticketId}`),
      { headers }
    );
    
    check(ticketRes, {
      'get ticket by id returns response': (r) => r.status >= 200 && r.status < 500,
    });
  }

  // Note: We don't test create/delete tickets in stress test as they modify data

  sleep(1);
}
