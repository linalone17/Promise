import { resolveProjectReferencePath } from "typescript";

type Nullable<T> = T | null | undefined;

type Resolve<T> = (value: T) => void;
type Reject = (reason?: any) => void;
type Status = 'pending' | 'fulfilled' | 'rejected';
type OnResolve<T> = (value: T) => MyPromise<unknown> | unknown;
type OnReject = (reason?: any) => void;
type Action<T> = {
    onResolve: Nullable<OnResolve<T>>;
    onReject: Nullable<OnReject>;
    resolveNext: Resolve<unknown>;
    rejectNext: Reject;
}
type RejectedAsObject = {
    status: 'rejected';
    reason?: any;
}

type FulfilledAsObject = {
    status: 'fulfilled';
    value: unknown;
}
type SettledAsObject = RejectedAsObject | FulfilledAsObject;


// "private" fields for external use, especially Promise.all/allSettled/race
const $$onResolve = Symbol('onResolve');
const $$onReject = Symbol('onReject');

export class MyPromise<T> {
    #status: Status = 'pending';
    #actionQueue: Action<T>[] = [];
    #data: any = null; // error or value;

    // controlled via $$ props
    #onResolveQueue: Resolve<T>[] = [];
    #onRejectQueue: Reject[] = [];

    constructor (executor: (resolve: Resolve<T>, reject: Reject) => void) {
        executor(this.#resolve.bind(this), this.#reject.bind(this));
    }

    #resolve (value: T) {
        if (this.#status !== "pending") return;

        this.#status = 'fulfilled';
        this.#data = value;
        this.#onResolveQueue.forEach(fn => fn(value));

        this.#actionQueue.forEach((action) => {
            queueMicrotask(() => {
                const cbReturn = action.onResolve ? action.onResolve(value) : undefined;
                if (cbReturn instanceof MyPromise) {

                    cbReturn
                        .then(
                            (value) => {action.resolveNext(value)},
                            (reason) => {action.rejectNext(reason)}
                        )
                        
                } else {
                    action.resolveNext(cbReturn);
                }
            })
        })
    }

    static resolve<T> (value: T) {
        return new MyPromise<T>((res) => {res(value)})
    }

    #reject (reason?: any) {
        if (this.#status !== "pending") return;

        this.#status = 'rejected';
        this.#data = reason;
        this.#onRejectQueue.forEach(fn => fn(reason));

        this.#actionQueue.forEach((action) => {
            if (action.onReject) {
                action.resolveNext(action.onReject(reason));
            } else {
                action.rejectNext(reason);
            }
        
        })
    }

    static reject (reason?: any) {
        return new MyPromise((_, rej) => {rej(reason)})
    }

    then(onResolve?: OnResolve<T>, onReject?: OnReject): MyPromise<unknown> {
        switch(this.#status) {
            case "pending":
                return new MyPromise((res, rej) => {
                    this.#actionQueue.push({
                        onResolve,
                        onReject,
                        resolveNext: res,
                        rejectNext: rej
                    })
                })
            case "fulfilled":
                return new MyPromise((res, rej) => {
                    queueMicrotask(() => {
                        const cbReturn = onResolve ? onResolve(this.#data) : undefined;
                        if (cbReturn instanceof MyPromise) {
                            cbReturn
                                .then(
                                    (value) => res(value),
                                    (reason) => rej(reason)
                                )
                        } else {
                            res(cbReturn)
                        }
                    })
                })
            case "rejected":
                return new MyPromise((res, rej) => {
                    queueMicrotask(() => {
                        if (onReject) {
                            res(onReject(this.#data));
                        } else {
                            rej(this.#data);
                        }
                    })
                })
        }
    }

    catch(onReject: OnReject) {
        return this.then(undefined, onReject)
    }

    static all (promises: MyPromise<unknown>[]) {
        let resolvedAmount = 0;
        const promisesAmount = promises.length;
        return new MyPromise((resolve, reject) => {
            promises.forEach((promise) => {
                promise[$$onReject] = (reason) => {
                    reject(reason)
                }
                promise[$$onResolve] = () => {
                    resolvedAmount++;

                    if (resolvedAmount === promisesAmount) {
                        resolve(promises.map((promise) => promise.#data));
                    }
                }
            })
        })
    }

    static allSettled (promises: MyPromise<unknown>[]) {
        let settledAmount = 0;
        const promisesAmount = promises.length;

        return new MyPromise((resolve) => {
            promises.forEach((promise) => {
                promise[$$onReject] = () => {
                    settledAmount++;
                }
                promise[$$onResolve] = () => {
                    settledAmount++;

                    if (settledAmount === promisesAmount) {
                        resolve(promises.map((promise) => {
                            return promise.#status === 'fulfilled'
                                ? {status: promise.#status, value: promise.#data}
                                : {status: promise.#status, reason: promise.#data}
                        }))
                    }
                }
            })
        })
    }

    static race (promises: MyPromise<unknown>[]) {
        return new MyPromise((resolve, reject) => {
            promises.forEach((promise) => {
                promise[$$onReject] = (reason) => {
                    reject(reason);
                }
                promise[$$onResolve] = (value) => {
                    resolve(value);
                }
            })
        })
    }

    static any (promises: MyPromise<unknown>[]) {
        const promisesAmount = promises.length;
        
        return new MyPromise((resolve, reject) => {
            const reasons: Array<any> = [];
            MyPromise.allSettled(promises).then((value) => {
                const settled = value as SettledAsObject[];

                for (let i = 0; i < settled.length; i++) {
                    const item = settled[i];

                    if (item.status === 'fulfilled') {
                        resolve(item.value);
                        break;
                    } else {
                        reasons.push(item.reason);
                    }
                }
                reject(new AggregateError(reasons, 'All promises were rejected'));
            })
        })
    }

    set [$$onResolve](onResolve: Resolve<T>) {
        if (this.#status === 'pending') {
            this.#onResolveQueue.push(onResolve);
        } else if (onResolve) {
            onResolve(this.#data);
        }
    }


    set [$$onReject](onReject: Reject) {
        if (this.#status === 'pending') {
            this.#onRejectQueue.push(onReject);
        } else if (onReject) {
            onReject(this.#data);
        }
    }
    

    get [Symbol.toStringTag]() {
        switch(this.#status) {
            case 'pending':
                return 'Promise: <pending>'
            default:
                return `Promise: <${this.#status}>: ${this.#data}`
        }
    }
}

// a lil bit of testing
// const Promise = MyPromise; // (un)comment to switch between MyPromise and Promise

// function sleep(ms: number) {
//     return new Promise((res) => {setTimeout(res, ms)})
// }

// console.log('grim');

// const a = new Promise<string>((res) => {
//     res('a')
// })
// .then((val) => {
//     console.log(val);
//     return sleep(3000);
// })
// .then(() => {
//     console.log('after sleep');
//     return Promise.resolve('value')
// })
// .then((value) => {
//     console.log('should be value:', value)
// })

// const b = Promise.resolve('hello').then((value) => value);

// b.then((value) => console.log('1:', value));
// b.then((value) => console.log('2:', value));
// b.then((value) => console.log('3:', value));
// b.then((value) => console.log('4:', value));

// const c = Promise.reject('not funny')
//     .then(value => {
//         console.log('shouldnt be logged')
//         return sleep(3000);
//     })
// const d = c
//     .catch(reason => {
//         console.log('rejected, reason:', reason)
//         return 1
//     })
// const e = d
//     .then((value) => {
//         console.log('undefined', value)
//     })
// setTimeout(() => {console.log(c, d, e)}, 5000) // rejected, fulfilled: 1, fulfilled: undefined

// const f = new Promise((res, rej) => {
//     setTimeout(() => res(1000), 1000)
// })
// .then((value) => {
//     console.log(value);
//     return value
// });

// const g = new Promise((res, rej) => {
//     setTimeout(() => res(5000), 5000)
// })
// .then((value) => {
//     console.log(value);
//     return value
// });

// const h = new Promise((res, rej) => {
//     setTimeout(() => res(2000), 2000)
// })
// .then((value) => {
//     console.log(value);
//     return value
// });

// const i = new Promise((res, rej) => {
//     setTimeout(() => rej('rejected'), 10000)
// })
// .then((value) => {
//     console.log(value);
//     return value
// });
// const j = new Promise((res, rej) => {
//     setTimeout(() => rej('rejected'))
// })
// .then((value) => {
//     console.log(value);
//     return value
// });

// const all = Promise.all([f, g, h]).then(console.log);
// const allRej = Promise.all([f, g, h, i]).then(console.log).catch(console.log);

// const race = Promise.race([f, g, h, i])
//     .then((v) => console.log('race resolved', v)).catch((r) => console.log('race rejected', r)); //rejected

// const raceRej = Promise.race([f, g, h, i, j])
//     .then((v) => console.log('race resolved', v)).catch((r) => console.log('race rejected', r)); //resolved
// console.log('beam');