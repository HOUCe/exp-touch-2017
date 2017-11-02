import $ from './zepto.js';
import * as Tools from './tools.es';

class ExpTouch {
    constructor (opt) {
        // normalize Date.now
        if (!Date.now) {
            Date.now = function () { 
                return new Date().getTime(); 
            };
        }

        // check requestAnimationFrame/cancelAnimationFrame
        const vendors = ['webkit', 'moz'];
        for (let i = 0; i < vendors.length && !window.requestAnimationFrame; ++i) {
            let vp = vendors[i];
            window.requestAnimationFrame = window[vp + 'RequestAnimationFrame'];
            window.cancelAnimationFrame = (window[vp + 'CancelAnimationFrame']
                                        || window[vp + 'CancelRequestAnimationFrame']);
        }
        // requestAnimationFrame/cancelAnimationFrame pollfillnot iOS6(is buggy)
        if (/iP(ad|hone|od).*OS 6/.test(window.navigator.userAgent)
            || !window.requestAnimationFrame || !window.cancelAnimationFrame) {
            let lastTime = 0;
            window.requestAnimationFrame = function (callback) {
                let now = Date.now();
                let nextTime = Math.max(lastTime + 16, now);
                return setTimeout(function () { callback (lastTime = nextTime); }, nextTime - now);
            };
            window.cancelAnimationFrame = clearTimeout;
        }

        // check and normalize css prefix
        const elementStyle = document.createElement('div').style;
        if ('transform' in elementStyle) {
            this.transform = 'transform';
            this.endTransitionEventName = 'transitionend';
            this.transitionDuration = 'transitionDuration';
            this.transitionTimingFunction = 'transitionTimingFunction';
        } 
        else if ('webkitTransform' in elementStyle) {
            this.transform = 'webkitTransform';
            this.endTransitionEventName = 'webkitTransitionEnd';
            this.transitionDuration = 'webkitTransitionDuration';
            this.transitionTimingFunction = 'webkitTransitionTimingFunction';
        } 
        else {
            throw 'not support css3 transform, please use a modern browser!'
        }

        this.tickID = 0;

        // 运动的对象
        this.target = opt.target;
        // 反馈触摸的 dom
        this.element = typeof opt.touch === "string" ? document.querySelector(opt.touch) : opt.touch;
        // 只监听垂直方向
        this.vertical = Tools.getValue(opt.vertical, true);
        // 代表用户起手时候是横向的，而你监听的是竖直方向的 touch，这样的话是不会触发运动。
        this.lockDirection = Tools.getValue(opt.lockDirection, true);
        // 随手势变化的 css 属性
        this.property = opt.property;
        // 随手势变化的 css 属性，初始状态值
        this.initialValue = Tools.getValue(opt.initialValue, this.target[this.property]);
        this.target[this.property] = this.initialValue;
        // preventDefault support
        this.preventDefault = Tools.getValue(opt.preventDefault, true);
        this.preventDefaultException = {tagName: /^(INPUT|TEXTAREA|BUTTON|SELECT)$/};
        // 灵敏度
        this.sensitivity = Tools.getValue(opt.sensitivity, 1);
        // 运动缓冲系数
        this.moveFactor = Tools.getValue(opt.moveFactor, 1);
        this.factor = Tools.getValue(opt.factor, 1);
        // 用来设置超出 min 或者 max 进行拖拽的运动比例系数。系数越小，超出 min 和 max 越难拖动，也就是受到的阻力越大。
        this.outFactor =  Tools.getValue(opt.outFactor, 0.3);
        // 固定元素
        this.fixed = Tools.getValue(opt.fixed, false);
        // min 和 max 决定了可以滚到哪里，到了哪里会进行惰性回弹
        this.min = opt.min;
        this.max = opt.max;
        this.hasMin = !(this.min === void 0);
        this.hasMax = !(this.max === void 0);
        this.deceleration = 0.0006;
        this.maxRegion = Tools.getValue(opt.maxRegion, 600);
        this.springMaxRegion = Tools.getValue(opt.springMaxRegion, 60);

        this.change = opt.change || function () { };
        this.touchEnd = opt.touchEnd || function () { };
        this.touchStart = opt.touchStart || function () { };
        this.tap = opt.tap || function () { };
        this.touchMove = opt.touchMove || function () { };
        this.touchCancel = opt.touchMove || function () { };
        this.reboundEnd = opt.reboundEnd || function () { };
        this.animationEnd = opt.animationEnd || function () { };
        this.correctionEnd = opt.correctionEnd || function () { };
        this.pressMove = opt.pressMove || function () { };


        this.isTouchStart = false;
        this.step = opt.step;
        this.inertia = Tools.getValue(opt.inertia, true);
        // 限制滚动的最大速度
        this.maxSpeed = opt.maxSpeed;
        this.hasMaxSpeed = !(this.maxSpeed === void 0);

        if (this.hasMax && this.hasMin) {
            if (this.min > this.max) throw "min value can't be greater than max value";
            this.currentPage = Math.round((this.max - this.target[this.property]) / this.step);
        }

        // bind this
        this.startHandler = this.start.bind(this);
        this.moveHandler = this.move.bind(this);
        this.endHandler = this.end.bind(this);
        this.cancelHandler = this.cancel.bind(this);

        this.calculateIndex();

        // bind event and trigger event handler
        $(this.element).on('touchstart', (e) => {
            this.startHandler(e);
        });
        $(window).on('touchmove', (e) => {
            this.moveHandler(e);
        });
        $(window).on('touchend', (e) => {
            this.endHandler(e);
        });
        $(window).on('touchcancel', (e) => {
            this.cancelHandler(e);
        });

        this.startX = this.moveX = this.startY = this.moveY = null;
    }
    start(event) {
        // 先中止动画帧
        cancelAnimationFrame(this.tickID);

        this.isTouchStart = true;
        this.firstTouchMove = true;
        this.preventMove = false;
        this.startTime = new Date().getTime();
        this.startX = this.preX = event.touches[0].pageX;
        this.startY = this.preY = event.touches[0].pageY;
        this.start = this.vertical ? this.preY : this.preX;

        // 调用业务代码自定义 touchStart 函数
        this.touchStart.call(this, event, this.target[this.property]);
        this.calculateIndex();
    }
    move(event) {
        if (this.isTouchStart) {
            const len = event.touches.length;
            const currentX = event.touches[0].pageX;
            const currentY = event.touches[0].pageY;

            let dx = Math.abs(currentX - this.startX);
            let dy = Math.abs(currentY - this.startY);

            if (this.firstTouchMove && this.lockDirection) {
                var dDis = dx - dy;
                // x 方向位移大于 y 方向的位移且监控垂直方向的滑动
                if (dDis > 0 && this.vertical) {
                    this.preventMove = true;
                }
                // x 方向位移小于 y 方向的位移且监控水平方向上的滑动
                else if (dDis < 0 && !this.vertical) {
                    this.preventMove = true;
                }
                this.firstTouchMove = false;
            }

            if (dx < 10 && dy < 10) return;

            if (!this.preventMove) {
                var f = this.moveFactor;
                var d = (this.vertical ? currentY - this.preY : currentX - this.preX) * this.sensitivity;
                if (this.hasMax && this.target[this.property] > this.max && d > 0) {
                    f = this.outFactor;
                } 
                else if (this.hasMin && this.target[this.property] < this.min && d < 0) {
                    f = this.outFactor;
                }
                d *= f;
                this.preX = currentX;
                this.preY = currentY;

                if (!this.fixed) {
                    this.target[this.property] += d;
                }
                this.change.call(this, this.target[this.property]);

                var timestamp = new Date().getTime();
                if (timestamp - this.startTime > 300) {
                    this.startTime = timestamp;
                    this.start = this.vertical ? this.preY : this.preX;
                }
                this.touchMove.call(this, event, this.target[this.property]);
            }

            if (this.preventDefault && !Tools.preventDefaultTest(event.target, this.preventDefaultException)) {
                event.preventDefault();
            }

            if (len === 1) {
                if (this.moveX !== null) {
                    event.deltaX = currentX - this.moveX;
                    event.deltaY = currentY - this.moveY;
                } 
                else {
                    event.deltaX = 0;
                    event.deltaY = 0;
                }
                this.pressMove.call(this, event, this.target[this.property]);
            }

            this.moveX = currentX;
            this.moveY = currentY;
        }
    }
    end(event) {
        if (this.isTouchStart) {
            this.isTouchStart = false;
            const me = this;
            let current = this.target[this.property];

            const triggerTap = (Math.abs(event.changedTouches[0].pageX - this.startX) < 30 && Math.abs(event.changedTouches[0].pageY - this.startY) < 30);
            if (triggerTap) {
                this.tap.call(this, event, current);
            }

            if (this.touchEnd.call(this, event, current, this.currentPage) === false) {
                return;
            }

            if (this.hasMax && current > this.max) {
                this.to(this.max, 200, Tools.ease, this.change, function (value) {
                    this.reboundEnd.call(this, value);
                    this.animationEnd.call(this, value);
                }.bind(this));
            } 
            else if (this.hasMin && current < this.min) {
                this.to(this.min, 200, Tools.ease, this.change, function (value) {
                    this.reboundEnd.call(this, value);
                    this.animationEnd.call(this, value);
                }.bind(this));
            } 
            else if (this.inertia && !triggerTap && !this.preventMove) {
                const dt = new Date().getTime() - this.startTime;
                if (dt < 300) {
                    let distance = ((this.vertical ? event.changedTouches[0].pageY : event.changedTouches[0].pageX) - this.start) * this.sensitivity;
                    let speed = Math.abs(distance) / dt;
                    let speed2 = this.factor * speed;

                    if (this.hasMaxSpeed && speed2 > this.maxSpeed) {
                        speed2 = this.maxSpeed;
                    }

                    let destination = current + (speed2 * speed2) / (2 * this.deceleration) * (distance < 0 ? -1 : 1);
                    let tRatio = 1;

                    if (destination < this.min) {
                        if (destination < this.min - this.maxRegion) {
                            tRatio = Tools.reverseEase((current - this.min + this.springMaxRegion) / (current - destination));
                            destination = this.min - this.springMaxRegion;
                        } 
                        else {
                            tRatio = Tools.reverseEase((current - this.min + this.springMaxRegion * (this.min - destination) / this.maxRegion) / (current - destination));
                            destination = this.min - this.springMaxRegion * (this.min - destination) / this.maxRegion;
                        }
                    } 
                    else if (destination > this.max) {
                        if (destination > this.max + this.maxRegion) {
                            tRatio = Tools.reverseEase((this.max + this.springMaxRegion - current) / (destination - current));
                            destination = this.max + this.springMaxRegion;
                        } 
                        else {
                            tRatio = Tools.reverseEase((this.max + this.springMaxRegion * (destination - this.max) / this.maxRegion - current) / (destination - current));
                            destination = this.max + this.springMaxRegion * (destination - this.max) / this.maxRegion;
                        }
                    }
                    let duration = Math.round(speed / me.deceleration) * tRatio;

                    me.to(Math.round(destination), duration, Tools.ease, me.change, function(value) {
                        if (me.hasMax && me.target[me.property] > me.max) {
                            cancelAnimationFrame(me.tickID);
                            me.to(me.max, 600, Tools.ease, me.change, me.animationEnd);
                        } 
                        else if (me.hasMin && me.target[me.property] < me.min) {
                            cancelAnimationFrame(me.tickID);
                            me.to(me.min, 600, Tools.ease, me.change, me.animationEnd);
                        } 
                        else {
                            if (me.step) {
                                me.correction()
                            }
                            else {
                                me.animationEnd.call(me, value);
                            }
                        }
                        me.change.call(this, value);
                    });
                } 
                else {
                    me.correction();
                }
            } 
            else {
                me.correction();
            }
        }
        this.startX = this.moveX = this.startY = this.moveY = null;
    }
    cancel(event) {
        let current = this.target[this.property];
        this.touchCancel.call(this, event, current);
        this.end(event);
    }
    stop() {
        cancelAnimationFrame(this.tickID);
        this.calculateIndex();
    }
    // 私有方法
    to(value, time = 600, uEase, onChange, onEnd) {
        const me = this;

        if (this.fixed) {
            return;
        }

        let el = this.target;
        let property = this.property;
        let current = el[property];
        let dv = value - current;
        let beginTime = new Date();
        let ease = uEase || Tools.ease;

        function toTick() {
            let dt = new Date() - beginTime;

            if (dt >= time) {
                el[property] = value;
                onChange && onChange.call(me, value);
                console.log(onEnd)
                onEnd && onEnd.call(me, value);
                return;
            }

            el[property] = dv * ease(dt / time) + current;
            me.tickID = requestAnimationFrame(toTick);
            onChange && onChange.call(me, el[property]);
        }
        toTick();
    }
    // 业务端执行运动逻辑，调用 exposeTo
    exposeTo(v, time, uEase) {
        this.to(v, Tools.getValue(time, 600), uEase || Tools.ease, this.change, function (value) {
            this.calculateIndex();
            this.reboundEnd.call(this, value);
            this.animationEnd.call(this, value);
        }.bind(this));
    }
    correction() {
        if (this.step === void 0) {
            return;
        }

        const el = this.target;
        const property = this.property;
        const value = el[property];

        let rpt = Math.floor(Math.abs(value / this.step));
        let dy = value % this.step;
        let result;

        if (Math.abs(dy) > this.step / 2) {
            result = (value < 0 ? -1 : 1) * (rpt + 1) * this.step;
            if (result > this.max) {
                result = this.max;
            }
            if (result < this.min) {
                result = this.min;
            }
            this.to(result, 400, Tools.ease, this.change, function(value) {
                this.calculateIndex();
                this.correctionEnd.call(this, value);
                this.animationEnd.call(this, value);
            }.bind(this));
        } 
        else {
            result = (value < 0 ? -1 : 1) * rpt * this.step;
            if (result > this.max) {
                result = this.max;
            }
            if (result < this.min) {
                result = this.min;
            }
            this.to(result, 400, Tools.ease, this.change, function(value) {
                this.calculateIndex();
                this.correctionEnd.call(this, value);
                this.animationEnd.call(this, value);
            }.bind(this));
        }
    }
    calculateIndex() {
        if (this.hasMax && this.hasMin) {
            this.currentPage = Math.round((this.max - this.target[this.property]) / this.step);
        }
    }
    destory() {
        $(this.element).off('touchstart');
        $(this.target).off(this.endTransitionEventName);
        $(window).off('touchmove');
        $(window).off('touchend');
        $(window).off('touchcancel');
    }
}

export {ExpTouch};

































