export interface ReadingState {
  following: boolean;
  turnId?: string;
  anchorId?: string;
  offset: number;
  scrollTop: number;
}
export class ConversationReadingCache {
  private entries = new Map<
    string,
    { reading?: ReadingState; choices: Map<string, unknown> }
  >();
  constructor(private capacity = 100) {}
  entry(scope: string, threadId: string) {
    const key = JSON.stringify([scope, threadId]);
    let value = this.entries.get(key);
    if (!value) value = { choices: new Map() };
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity)
      this.entries.delete(this.entries.keys().next().value!);
    return value;
  }
}
export const conversationReadingCache = new ConversationReadingCache();
