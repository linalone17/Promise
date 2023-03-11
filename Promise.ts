type Nullable<T> = T | null | undefined;
type AnyFunction = (...args: any) => any;

type Resolve<T> = (value: T) => void;
type Reject = (reason?: any) => void
type Status = 'pending' | 'fulfilled' | 'rejected';
type OnResolve<T> = (value: T) => MyPromise<unknown> | unknown;
type OnReject = (reason?: any) => void;
type Action = {
    onResolve: Nullable<OnResolve<any>>;
    onReject: Nullable<OnReject>;
    resolveNext: Resolve<any>;
    rejectNext: Reject;
}


// "private" fields for external use, especially Promise.all/allSettled/race
const $$onResolve = Symbol('onResolve');
const $$onReject = Symbol('onReject');

export class MyPromise<T> {
    status: Status;
    actionQueue: Action[];
    private data: any = null; // error or value
    [$$onResolve]: Nullable<AnyFunction> = null;
    [$$onReject]: Nullable<AnyFunction> = null;

    constructor (executor: (resolve: Resolve<T>, reject: Reject) => void) {
        this.status = 'pending';
        this.actionQueue = [];
        this.resolve = this.resolve.bind(this);
        this.reject = this.reject.bind(this);
        executor(this.resolve, this.reject);
    
    }

    resolve (value: T) {
        if (this.status !== "pending") return;

        this.status = 'fulfilled';
        this.data = value;
        if (this[$$onResolve]) this[$$onResolve]();

        this.actionQueue.forEach((action) => {
            queueMicrotask(() => {
                const cbReturn = action.onResolve ? action.onResolve(value) : undefined;
                if (cbReturn instanceof MyPromise) {

                    cbReturn
                        .then((val) => {
                            action.resolveNext(val);
                        })
                        .catch((reason: any) => {
                            action.rejectNext(reason);
                        })
                } else {
                    action.resolveNext(cbReturn);
                }
            })
        })
    }

    static resolve<T> (value: T) {
        return new MyPromise<T>((res) => {res(value)})
    }

    reject (reason?: any) {
        if (this.status !== "pending") return;

        this.status = 'rejected';
        this.data = reason;
        if (this[$$onReject]) this[$$onReject]();

        this.actionQueue.forEach((action) => {
            if (action.onReject) action.onReject(reason);
            action.rejectNext(reason);
        })
    }

    static reject (reason?: any) {
        return new MyPromise((_, rej) => {rej(reason)})
    }

    then<T>(onResolve?: OnResolve<T>, onReject?: OnReject): MyPromise<unknown> {
        switch(this.status) {
            case "pending":
                return new MyPromise((res, rej) => {
                    this.actionQueue.push({
                        onResolve,
                        onReject,
                        resolveNext: res,
                        rejectNext: rej
                    })
                })
            case "fulfilled":
                return new MyPromise((res, rej) => {
                    queueMicrotask(() => {
                        const cbReturn = onResolve ? onResolve(this.data) : undefined;
                        if (cbReturn instanceof MyPromise) {
                            cbReturn
                                .then((value) => res(value))
                                .catch((reason) => rej(reason))
                        } else {
                            res(cbReturn)
                        }
                    })
                })
            case "rejected":
                return new MyPromise((_, rej) => {
                    queueMicrotask(() => {
                        if (onReject) onReject(this.data);
                        rej();
                    })
                })
        }
    }

    catch(onReject: OnReject) {
        return this.then(undefined, onReject)
    }

    all (promises: MyPromise<unknown>[]) {
        let resolvedAmount = 0;
        const promisesAmount = promises.length;
        return new MyPromise((res, rej) => {
            promises.forEach((promise) => {
                promise[$$onReject] = () => {
                    rej()
                }
                promise[$$onResolve] = () => {
                    resolvedAmount++;
                    if (resolvedAmount === promisesAmount) {
                    }
                }
            })
        })
    }

    allSettled (promises: MyPromise<unknown>[]) {

    }

    race (promises: MyPromise<unknown>[]) {

    }
}

// a lil bit of testing
const Promise = MyPromise; // (un)comment to switch between MyPromise and Promise

function sleep(ms: number) {
    return new Promise((res) => {setTimeout(res, ms)})
}

const a = new Promise<string>((res) => {
    res('a')
})
.then((val) => {
    console.log(val);
    return sleep(3000);
})
.then(() => {
    console.log('after sleep');
    return Promise.resolve('value')
})
.then((value) => {
    console.log('should be value:', value)
})

// const a = Promise.resolve('hello').then((value) => console.log(value));
console.log('grim')
console.log('beam')