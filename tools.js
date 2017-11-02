// 取值，如果该值不存在，则使用默认值
export const getValue = (obj, defaultValue) => obj === void 0 ? defaultValue : obj;

// 动画曲线
export const ease = (x) => Math.sqrt(1 - Math.pow(x - 1, 2));
export const reverseEase = (y) => (1 - Math.sqrt(1 - y * y));


export const preventDefaultTest = (el, exceptions) => {
    for (var i in exceptions) {
        if (exceptions[i].test(el[i])) {
            return true;
        }
    }
    return false;
}

