import {
  type Interceptor,
  type InterceptingCall,
  InterceptingCall as InterceptingCallCtor,
  Metadata,
} from '@grpc/grpc-js';

/**
 * @grpc/grpc-js client-side Interceptor that attaches a Bearer token on
 * every outbound call. The token provider is called per RPC so callers
 * can rotate / refresh (e.g. fetch a fresh short-lived JWT from STS).
 *
 *     import { credentials, Client } from '@grpc/grpc-js';
 *     const interceptors = [makeAuthInterceptor(() => latestToken)];
 *     const client = new Client(addr, credentials.createInsecure(), { interceptors });
 *
 * Pair this with NestJS's `ClientsModule.register({ options: { credentials, channelOptions: { interceptors } } })`
 * to wire it through the @nestjs/microservices client surface.
 */
export function makeAuthInterceptor(
  tokenProvider: () => string | Promise<string>,
): Interceptor {
  return (options, nextCall): InterceptingCall => {
    return new InterceptingCallCtor(nextCall(options), {
      start: async (metadata, listener, next) => {
        const token = await Promise.resolve(tokenProvider());
        const md = metadata instanceof Metadata ? metadata : new Metadata();
        md.set('authorization', `Bearer ${token}`);
        next(md, listener);
      },
    });
  };
}
