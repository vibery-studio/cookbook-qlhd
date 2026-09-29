/** Thrown by contract service stubs until their wave-2 card lands; routes map it to a 501 Problem. */
export class NotImplementedYet extends Error {
  constructor(what = "not implemented") {
    super(what);
    this.name = "NotImplementedYet";
  }
}
