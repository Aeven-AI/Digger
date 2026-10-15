// Direction/fire key latching, ported from Input.js. The host feeds key state
// through press()/release(); the sim samples it once per tick via readdir().

export type Key = 'left' | 'right' | 'up' | 'down' | 'fire';

export class Input {
  leftpressed = false;
  rightpressed = false;
  uppressed = false;
  downpressed = false;
  f1pressed = false;
  firepressed = false;
  escape = false;
  dynamicdir = -1;
  staticdir = -1;
  keydir = 0;
  firepflag = false;

  press(k: Key): void {
    switch (k) {
      case 'left':
        this.leftpressed = true;
        this.dynamicdir = this.staticdir = 4;
        break;
      case 'right':
        this.rightpressed = true;
        this.dynamicdir = this.staticdir = 0;
        break;
      case 'up':
        this.uppressed = true;
        this.dynamicdir = this.staticdir = 2;
        break;
      case 'down':
        this.downpressed = true;
        this.dynamicdir = this.staticdir = 6;
        break;
      case 'fire':
        this.firepressed = true;
        this.f1pressed = true;
        break;
    }
  }

  release(k: Key): void {
    switch (k) {
      case 'left':
        this.leftpressed = false;
        if (this.dynamicdir == 4) this.setdirec();
        break;
      case 'right':
        this.rightpressed = false;
        if (this.dynamicdir == 0) this.setdirec();
        break;
      case 'up':
        this.uppressed = false;
        if (this.dynamicdir == 2) this.setdirec();
        break;
      case 'down':
        this.downpressed = false;
        if (this.dynamicdir == 6) this.setdirec();
        break;
      case 'fire':
        this.f1pressed = false;
        break;
    }
  }

  releaseAll(): void {
    this.leftpressed = this.rightpressed = this.uppressed = this.downpressed = false;
    this.f1pressed = this.firepressed = false;
    this.dynamicdir = this.staticdir = -1;
  }

  getdir(): number {
    return this.keydir;
  }

  readdir(): void {
    this.keydir = this.staticdir;
    if (this.dynamicdir != -1) this.keydir = this.dynamicdir;
    this.staticdir = -1;
    this.firepflag = this.f1pressed || this.firepressed;
    this.firepressed = false;
  }

  setdirec(): void {
    this.dynamicdir = -1;
    if (this.uppressed) this.dynamicdir = this.staticdir = 2;
    if (this.downpressed) this.dynamicdir = this.staticdir = 6;
    if (this.leftpressed) this.dynamicdir = this.staticdir = 4;
    if (this.rightpressed) this.dynamicdir = this.staticdir = 0;
  }

  getfirepflag(): boolean {
    return this.firepflag;
  }
}
