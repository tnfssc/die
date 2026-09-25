/** Operations of the owning session. Input adapters share its agent and task execution. */
export interface SessionOperations {
  /** App-authored contextual delegation with quoted provisional context, never final ASR. */
  delegate?(requestId: string, context: string): Promise<unknown>;
  send(requestId: string, text: string): Promise<unknown>;
  steer(requestId: string, text: string): Promise<unknown>;
  list(options?: { cursor?: string | number; count?: number }): Promise<unknown>;
  inspect(id: string, offset?: number): Promise<unknown>;
  stop(requestId: string, id: string): Promise<unknown>;
  context(): unknown;
  subscribe(listener: (update: any) => void): () => void;
}
