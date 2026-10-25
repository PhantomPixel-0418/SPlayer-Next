/** 拥有一个 HTML 元素的接口 */
export interface HasElement {
  /** 获取这个类所对应的 HTML 元素实例 */
  getElement(): HTMLElement;
}

/** 实现了此接口的对象在使用完毕后需手动调用 dispose 释放资源 */
export interface Disposable {
  /** 销毁对象实例，释放占用的资源 */
  dispose(): void;
}
