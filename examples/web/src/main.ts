/**
 * Browser-side demo — calls service-a's OrdersService over the
 * Connect protocol (HTTP/JSON over fetch). For raw gRPC backends, run
 * a Connect-aware gateway (envoy with grpc_web filter, vanguard,
 * connect-go) in front of the Node server and point baseUrl at it.
 *
 *     pnpm --filter @example/web dev    # http://localhost:5173
 *
 * Configure the gateway URL via the input on the page (defaults to
 * http://localhost:8080, which most local Connect setups use).
 */
import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { OrdersService } from '@repo/connect-web/orders/v1';

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
}

function buildClient() {
  const baseUrl = $<HTMLInputElement>('baseUrl').value.trim();
  return createClient(OrdersService, createConnectTransport({ baseUrl }));
}

async function runGetOrder() {
  const out = $<HTMLPreElement>('getOrderOut');
  out.textContent = '...';
  try {
    const id = $<HTMLInputElement>('orderId').value.trim();
    const res = await buildClient().getOrder({ id });
    out.textContent = JSON.stringify(res, jsonReplacer, 2);
  } catch (err) {
    out.textContent = `error: ${(err as Error).message}`;
  }
}

async function runListOrders() {
  const out = $<HTMLPreElement>('listOrdersOut');
  out.textContent = '';
  try {
    const customerId = $<HTMLInputElement>('customerId').value.trim();
    const stream = buildClient().listOrders({ customerId, limit: 0 });
    for await (const order of stream) {
      out.textContent += `${JSON.stringify(order, jsonReplacer)}\n`;
    }
  } catch (err) {
    out.textContent += `\nerror: ${(err as Error).message}`;
  }
}

// bigint isn't JSON-serializable; serialize as a string for display.
function jsonReplacer(_: string, v: unknown) {
  return typeof v === 'bigint' ? v.toString() : v;
}

$('getOrder').addEventListener('click', runGetOrder);
$('listOrders').addEventListener('click', runListOrders);
