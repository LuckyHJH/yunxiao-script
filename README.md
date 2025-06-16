# 云效代码库清理脚本

## 功能介绍

清理代码库中的长时间没更新分支

- 90天内有更新的分支不会被清理
- 默认分支不会被清理（云效设置的）
- 保护分支不会被清理（云效设置的）
- 主分支不会被清理（运行脚本时用户定义的）
- 排除分支不会被清理（运行脚本时用户定义的）
- 对比主分支有更新内容的不会被清理

## 安装说明

1. 此脚本是在浏览器中运行的，建议使用Chrome或基于Chromium内核的浏览器。
2. 浏览器安装插件 [篡改猴(Tampermonkey)](https://www.tampermonkey.net/)
3. 插件安装 [GitHub](https://github.com/LuckyHJH/yunxiao-script/raw/refs/heads/main/yunxiao-script.user.js)

## 使用方法

1. 打开云效代码库的分支列表页面，如`https://codeup.aliyun.com/{ORGANIZATION}/{REPOSITORY}/branches`
2. 在右上角“新建分支”按钮的旁边有个“清理已合并分支”按钮，点击并等待，不要刷新、关闭页面或点击其它链接。如未配置的先看下一步。
3. 配置里的token从 [个人访问令牌](https://account-devops.aliyun.com/settings/personalAccessToken) 获取，权限里选择代码管理的“**分支:读写**”，“**代码比较:只读**”，其它字段按需要填写。配置里的“主分支”和“排除分支”作用，可参考上面的“功能介绍”。

## 其它事项

### 菜单

点击浏览器右上角的插件按钮，菜单里有2个按钮：

- 配置信息：可配置token、主分支、排除分支等信息。
- 清空配置：清空所有配置信息。
