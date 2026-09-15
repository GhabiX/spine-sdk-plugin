import {
  decodeResponse,
  encodeCommand,
  SpineProtocolError,
  type Command,
  type CommandResult,
} from "./protocol.js";

export interface RuntimeTransport {
  dispatch(requestJson: string): Promise<string> | string;
}

export class SpineRuntimeClient {
  readonly #transport: RuntimeTransport;

  constructor(transport: RuntimeTransport) {
    this.#transport = transport;
  }

  async execute(command: Command): Promise<CommandResult> {
    const response = decodeResponse(await this.#transport.dispatch(encodeCommand(command)));
    if (!response.ok) {
      throw new SpineProtocolError(response.error.code, response.error.message);
    }
    return response.result;
  }
}
