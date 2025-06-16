// ==UserScript==
// @name         云效清理过期分支
// @namespace    https://github.com/LuckyHJH/yunxiao-script
// @version      1.0.0
// @description  云效清理过期分支
// @author       You
// @match        *://codeup.aliyun.com/*
// @match        *://account-devops.aliyun.com/settings/personalAccessTokenCreate*
// @connect      openapi-rdc.aliyuncs.com
// @icon         https://img.alicdn.com/imgextra/i2/O1CN01teF3oR212cGX7E1Qg_!!6000000006927-55-tps-102-102.svg
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    let yunxiaoToken = GM_getValue('yunxiao_token', '');//云效token，如"pt-UV0*******"
    let masterBranch = GM_getValue('master_branch', 'master');//主分支，如"master"
    let excludedBranches = GM_getValue('excluded_branches', 'release,main,prod,production,test,testing,dev,develop,staging,qa,gray,pre-release');//排除分支，多个分支用逗号隔开，如"release,main"
    let organizationId = '';// 组织ID，如"636d***3167"
    let repositoryId = '';// 代码组+代码库，如"test/demo"

    function clearOutdatedBranch() {
        const clearButton = document.getElementById('clear_button');
        clearButton.disabled = true;
        clearButton.textContent = '正在清理中...';

        let branchesToDelete = [];
        let processedCount = 0;
        // 递归获取所有分支
        async function getAllBranches(page = 1, allBranches = []) {
            const perPage = 100;
            const res = await ListBranches({ page, perPage });
            allBranches.push(...res);

            if (res.length === perPage) {
                return getAllBranches(page + 1, allBranches);
            }
            return allBranches;
        }

        getAllBranches().then(allBranches => {
            const daysAgo = new Date();
            daysAgo.setDate(daysAgo.getDate() - 90);// 如果最后提交时间是90天前就考虑清理
            const excludedBranchesList = excludedBranches.split(',');// 如果分支名称包含excludedBranches，就不考虑清理

            // 过滤需要检查的分支
            const branchesToCheck = allBranches.filter(branch => {
                const commitDate = new Date(branch.commit.committedDate);
                return !(branch.defaultBranch || branch.protected || commitDate > daysAgo || branch.name === masterBranch || excludedBranchesList.includes(branch.name));
            });

            if (branchesToCheck.length === 0) {
                myAlert('没有需要清理的分支');
                clearButton.disabled = false;
                clearButton.textContent = '清理已合并分支';
                return;
            }

            // 检查每个分支是否有更新内容
            branchesToCheck.forEach(branch => {
                GetCompare(masterBranch, branch.name).then(res => {
                    processedCount++;

                    if (res.diffs.length === 0) {//跟主分支没有差异才要清理
                        branchesToDelete.push(branch.name);
                    }

                    // 当所有分支都检查完毕时
                    if (processedCount === branchesToCheck.length) {
                        let successBranches = [];
                        let failedBranches = [];
                        Promise.all(branchesToDelete.map(branchName =>
                            DeleteBranch(branchName)
                                .then(() => successBranches.push(branchName))
                                .catch(err => failedBranches.push(branchName))
                        )).finally(() => {
                            let message = `清理完成：成功删除${successBranches.length}个分支`;
                            if (failedBranches.length > 0) {
                                message += `，失败${failedBranches.length}个`;
                            }
                            myAlert(message);
                            console.log('成功删除的分支:', successBranches);
                            if (failedBranches.length > 0) {
                                console.log('删除失败的分支:', failedBranches);
                            }
                            clearButton.disabled = false;
                            clearButton.textContent = '清理已合并分支';
                        });
                    }
                });
            });
        }).catch(err => {
            myAlert(err);
            clearButton.disabled = false;
            clearButton.textContent = '清理已合并分支';
        });
    }

    function ListRepositories(options = {}) {
        const { page = 1, perPage = 10, sort = 'updated_asc', search } = options;

        const path = `/repositories`;
        const queryParams = {
            page,
            perPage,
            sort,
            search
        };

        const apiUrl = buildApiUrl(path, queryParams, { 'noRepositoryId': true });
        return makeApiRequest(apiUrl, {
            successMessage: '获取代码库列表成功',
            errorMessage: '获取代码库列表失败'
        });
    }

    /**
     * 查询分支列表
     * @param {Object} options - 可选参数
     * @param {number} options.page - 页码，默认为1
     * @param {number} options.perPage - 每页大小，默认为10
     * @param {string} options.sort - 排序方式：name_asc - 名称升序，name_desc - 名称降序；updated_asc - 更新时间升序；updated_desc - 更新时间降序
     * @param {string} options.search - 查询条件
     * @returns {Promise} - 返回Promise对象，resolve时返回分支列表
     * @see https://help.aliyun.com/zh/yunxiao/developer-reference/listbranches-query-the-list-of-branches
     */
    function ListBranches(options = {}) {
        const { page = 1, perPage = 10, sort, search } = options;

        const path = `/branches`;
        const queryParams = {
            page,
            perPage,
            sort,
            search
        };

        const apiUrl = buildApiUrl(path, queryParams);
        return makeApiRequest(apiUrl, {
            successMessage: '获取分支列表成功',
            errorMessage: '获取分支列表失败'
        });
    }

    /**
     * 删除分支
     * @param {string} branchName - 要删除的分支名称
     * @returns {Promise} - 返回Promise对象，resolve时返回被删除的分支名称
     * @see https://help.aliyun.com/zh/yunxiao/developer-reference/deletebranch-delete-branch
     */
    function DeleteBranch(branchName) {
        if (!branchName) {
            return Promise.reject(new Error('分支名称不能为空'));
        }
        const encodedBranchName = urlEncoder(urlEncoder(branchName));// 对特殊字符进行两次编码,避免+等字符导致的删除失败
        const path = `/branches/${encodedBranchName}`;

        const apiUrl = buildApiUrl(path);
        return makeApiRequest(apiUrl, {
            method: 'DELETE',
            data: {},
            successMessage: `删除分支 ${branchName} 成功`,
            errorMessage: `删除分支 ${branchName} 失败`
        });
    }

    /**
     * 查询代码比较内容
     * @param {string} from - 可为 CommitSHA、分支名或者标签名。
     * @param {string} to - 可为 CommitSHA、分支名或者标签名。
     * @param {Object} options - 可选参数
     * @param {string} options.sourceType - 可选值：branch、tag；若是 commit 比较，可不传；若是分支比较，则需传入：branch，亦可不传，但需要确保不存在分支或 tag 重名的情况；若是 tag 比较，则需传入：tag；若是存在分支和标签同名的情况，则需要严格传入 branch 或者 tag。
     * @param {string} options.targetType - 可选值：branch、tag；若是 commit 比较，可不传；若是分支比较，则需传入：branch，亦可不传，但需要确保不存在分支或 Tag 重名的情况；若是 tag 比较，则需传入：tag；若是存在分支和标签同名的情况，则需要严格传入 branch 或者 tag。
     * @param {boolean} options.straight - 是否使用 Merge-Base：straight=false，表示使用 Merge-Base；straight=true，表示不使用 Merge-Base；默认为 false，即使用 Merge-Base。
     * @returns {Promise} - 返回Promise对象，resolve时返回比较内容。如果diffs有内容，就说明to有更新。
     * @see https://help.aliyun.com/zh/yunxiao/developer-reference/getcompare
     */
    function GetCompare(from, to, options = {}) {
        if (!from || !to) {
            return Promise.reject(new Error('from 和 to 参数不能为空'));
        }
        const { sourceType, targetType, straight } = options;

        const path = `/compares`;
        const queryParams = {
            from,
            to,
            sourceType,
            targetType,
            straight
        };

        const apiUrl = buildApiUrl(path, queryParams);
        return makeApiRequest(apiUrl, {
            successMessage: `获取 ${from} 和 ${to} 的比较内容成功`,
            errorMessage: `获取 ${from} 和 ${to} 的比较内容失败`
        });
    }

    /**
     * 构建API URL和查询参数
     * @param {string} path - API路径
     * @param {Object} queryParams - 查询参数对象
     * @param {Object} options - 可选参数
     * @param {boolean} options.noRepositoryId - 是否不包含代码库ID，默认为false
     * @returns {string} - 完整的API URL
     * @see https://help.aliyun.com/zh/yunxiao/developer-reference/service-access-point-domain
     */
    function buildApiUrl(path, queryParams = {}, options = {}) {
        if (!organizationId) {
            return Promise.reject(new Error('请先配置组织ID'));
        }
        const { noRepositoryId = false } = options;

        const baseUrl = `https://openapi-rdc.aliyuncs.com/oapi/v1/codeup/organizations/${organizationId}`;

        if (repositoryId && !noRepositoryId) {//是否需要传代码库名称
            const encodedRepositoryId = urlEncoder(`${organizationId}/${repositoryId}`);
            path = `/repositories/${encodedRepositoryId}${path}`;
        }

        const queryString = Object.entries(queryParams)
            .filter(([_, value]) => value !== undefined && value !== null)
            .map(([key, value]) => `${key}=${urlEncoder(value)}`)
            .join('&');

        return `${baseUrl}${path}${queryString ? `?${queryString}` : ''}`;
    }

    /**
     * 发起API请求
     * @param {string} url - 请求URL
     * @param {Object} options - 请求选项
     * @param {string} options.method - 请求方法，默认为GET
     * @param {Object} options.data - 请求体数据，用于POST/PUT等方法
     * @param {string} options.successMessage - 成功时的日志消息
     * @param {string} options.errorMessage - 失败时的日志消息
     * @returns {Promise} - 返回Promise对象
     * @see https://help.aliyun.com/zh/yunxiao/developer-reference/obtain-personal-access-token
     * @see https://help.aliyun.com/zh/yunxiao/developer-reference/error-code-center
     */
    function makeApiRequest(url, options = {}) {
        if (!yunxiaoToken) {
            openConfigDialog();
            return Promise.reject(new Error('请先进行配置！'));
        }

        const {
            method = 'GET',
            data = null,
            successMessage = '请求成功',
            errorMessage = '请求失败'
        } = options;

        return new Promise((resolve, reject) => {
            const requestConfig = {
                method: method,
                url: url,
                headers: {
                    'Content-Type': 'application/json',
                    'x-yunxiao-token': yunxiaoToken
                },
                responseType: 'json',
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        console.log(`${successMessage}:`, response.response);
                        resolve(response.response);
                    } else {
                        let msg = '';
                        switch (response.response.errorCode) {
                            case 'Forbidden'://权限不足
                            case 'InvalidToken'://无效
                            case 'ExpiredToken'://已过期
                                msg = '该token无效或权限不足，请重新配置';
                                openConfigDialog();
                                break;
                            case 'Forbidden.InvalidUser.UserNotInCurrentOrganization'://organizationId有误
                            case 'SYSTEM_NOT_FOUND_ERROR'://可能是代码库没找到，编码问题？
                                msg = '发生异常，请联系开发者';
                                break;
                            default:
                                msg = `API请求失败: ${response.status} ${response.response.errorMessage}`;
                        }
                        const error = new Error(msg);
                        console.error(`${errorMessage}:`, error, response.response);
                        reject(error);
                    }
                },
                onerror: function(error) {
                    console.error(`${errorMessage}:`, error);
                    reject(error);
                }
            };

            if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
                requestConfig.data = JSON.stringify(data);
            }

            GM_xmlhttpRequest(requestConfig);
        });
    }

    /**
     * 打开配置对话框
     */
    function openConfigDialog() {
        const dialogHtml = `
        <div class="next-overlay-wrapper opened" id="config-dialog">
            <div class="next-overlay-backdrop"></div>
            <div class="next-overlay-inner next-dialog-wrapper">
                <div class="next-dialog-inner-wrapper" style="top: 100px; padding-bottom: 40px;">
                    <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-mc0bo17o" class="next-dialog next-closeable next-dialog-v2 create-branch-dialog" style="max-height: calc(-140px + 100vh); width: 600px;">
                        <div class="next-dialog-header" id="dialog-title-mc0bo17o" role="heading" aria-level="1">配置</div>
                        <div class="next-dialog-body" style="min-height: 103px; max-height: calc(-243px + 100vh); overflow-y: auto;">
                            <form role="grid" class="next-form next-medium create-branch-form">
                                <div class="next-form-item next-top next-medium">
                                    <div class="next-form-item-label next-left"><label for="yunxiao_token" required="">云效token</label></div>
                                    <div class="next-form-item-control">
                                        <span data-meta="Field" class="next-input next-medium"><input id="yunxiao_token" spellcheck="false" height="100%" autocomplete="off" value="${yunxiaoToken}" placeholder="如'pt-UV0*******'"></span>
                                        <div class="next-form-item-help">如何获取：<a href="https://account-devops.aliyun.com/settings/personalAccessTokenCreate?purpose=clear-branch" target="_blank">点击前往新建令牌</a>。权限里选择<b>代码管理</b>的"<b style="color:red;">分支:读写</b>"，"<b style="color:red;">代码比较:只读</b>"</div>
                                    </div>
                                </div>
                                <div class="next-form-item next-top next-medium">
                                    <div class="next-form-item-label next-left"><label for="master_branch" required="">主分支名称</label></div>
                                    <div class="next-form-item-control">
                                        <span data-meta="Field" class="next-input next-medium"><input id="master_branch" spellcheck="false" height="100%" autocomplete="off" value="${masterBranch}"></span>
                                        <div class="next-form-item-help">已合并到主分支的才会被清理</div>
                                    </div>
                                </div>
                                <div class="next-form-item next-top next-medium">
                                    <div class="next-form-item-label next-left"><label for="excluded_branches">排除分支</label></div>
                                    <div class="next-form-item-control">
                                        <span class="next-input next-input-textarea" data-meta="Field"><textarea id="excluded_branches" placeholder="请输入排除分支" maxlength="100" data-real="true" rows="3">${excludedBranches}</textarea></span>
                                        <div class="next-form-item-help">多个分支用逗号隔开（保护分支可不填）</div>
                                    </div>
                                </div>
                            </form>
                        </div>
                        <div class="next-dialog-footer next-align-right">
                            <button type="button" class="next-btn next-medium next-btn-primary next-dialog-btn" id="confirm-config-dialog">
                                <span class="next-btn-helper">确定</span>
                            </button>
                        </div>
                        <a role="button" aria-label="关闭" class="next-dialog-close" id="close-config-dialog">
                            <i class="next-icon next-icon-close next-medium next-dialog-close-icon"></i>
                        </a>
                    </div>
                </div>
            </div>
        </div>`
        const dialog = document.createElement('div');
        dialog.innerHTML = dialogHtml;
        document.body.appendChild(dialog);

        document.getElementById('close-config-dialog').addEventListener('click', () => {
            document.getElementById('config-dialog').remove();
        });

        document.getElementById('confirm-config-dialog').addEventListener('click', () => {
            const yunxiaoTokenInput = document.getElementById('yunxiao_token');
            const masterBranchInput = document.getElementById('master_branch');
            const excludedBranchesInput = document.getElementById('excluded_branches');
            if (yunxiaoTokenInput) {
                yunxiaoToken = yunxiaoTokenInput.value;
                GM_setValue('yunxiao_token', yunxiaoToken);
            }
            if (masterBranchInput) {
                masterBranch = masterBranchInput.value;
                GM_setValue('master_branch', masterBranch);
            }
            if (excludedBranchesInput) {
                excludedBranches = excludedBranchesInput.value;
                GM_setValue('excluded_branches', excludedBranches);
            }
            document.getElementById('config-dialog').remove();
        });
    }

    /**
     * 添加清理按钮
     */
    function addClearButton() {
        const match = isBranchListPage();
        if (match) {
            //云效应该是SPA，使用定时器来解决
            const interval = setInterval(function() {
                //获取organizationId和repositoryId，只能在分支列表页面使用此功能
                organizationId = match[1];
                repositoryId = match[2];

                const targetDiv = document.querySelector('#container > div:nth-child(1) > main > header > section > section > section > button.next-btn.next-medium.next-btn-primary.isFourCNCharBtn.is-yunxiao');
                if (targetDiv) {
                    const clearButton = document.createElement('button');
                    clearButton.type = 'button';
                    clearButton.id = 'clear_button';
                    clearButton.className = 'next-btn next-medium next-btn-normal cell is-yunxiao';
                    clearButton.textContent = '清理已合并分支';
                    clearButton.style.marginLeft = '8px';
                    clearButton.addEventListener('click', clearOutdatedBranch);
                    targetDiv.insertAdjacentElement('beforebegin', clearButton);

                    clearInterval(interval);//添加按钮后就清理定时器，所以只会显示一次
                }
            }, 1000);
        }
    }


    /**
     * 创建Token时提供一些友好帮助
     */
    function helpCreateToken() {
        const params = getQueryParams();
        if (params.purpose == 'clear-branch') {
            const codeupRow = document.querySelector('#container > main > section.teamix-layout-body > section > section > form > div:nth-child(5) > div.next-form-item-control > div > div:nth-child(3) > div.next-collapse-panel-title');
            if (!codeupRow) {
                return;
            }
            codeupRow.click();
            const branchText = document.querySelector('#container > main > section.teamix-layout-body > section > section > form > div:nth-child(5) > div.next-form-item-control > div > div.next-collapse-panel.next-collapse-panel-expanded > div.next-collapse-panel-content > div > div.next-table-inner > div.next-table-body > table > tbody > tr:nth-child(4) > td.next-table-cell.first > div > div');
            branchText.textContent = '分支（修改成“读写”）';
            branchText.style.color = 'red';
            const compareText = document.querySelector('#container > main > section.teamix-layout-body > section > section > form > div:nth-child(5) > div.next-form-item-control > div > div.next-collapse-panel.next-collapse-panel-expanded > div.next-collapse-panel-content > div > div.next-table-inner > div.next-table-body > table > tbody > tr:nth-child(7) > td.next-table-cell.first > div > div');
            compareText.textContent = '代码比较（修改成“只读”）';
            compareText.style.color = 'red';
        }
    }


    /**
     * 判断是否是分支列表页面
     */
    function isBranchListPage() {
        return window.location.href.match(/codeup.aliyun.com\/([^/]+)\/(.+)\/branches*/);
    }

    /**
     * 判断是否是创建token页面
     */
    function isCreateTokenPage() {
        return window.location.href.match(/account-devops.aliyun.com\/settings\/personalAccessTokenCreate*/);
    }

    /**
     * 获取query参数
     */
    function getQueryParams() {
        const queryString = window.location.search;
        const urlParams = new URLSearchParams(queryString);
        const params = {};
        for (const [key, value] of urlParams) {
            params[key] = value;
        }
        return params;
    }

    /**
     * 对字符串进行URL编码
     * @param {string} str - 需要编码的字符串
     * @returns {string} - 编码后的字符串
     */
    function urlEncoder(str) {
        return encodeURIComponent(str);
    }

    function myAlert(msg) {
        alert(msg);
    }

    function setConfig() {
        openConfigDialog();
    }

    function clearConfig() {
        GM_deleteValue('yunxiao_token');
        GM_deleteValue('master_branch');
        GM_deleteValue('excluded_branches');
        alert('配置已被清空！');
        location.reload();
    }

    GM_registerMenuCommand ("配置信息", setConfig, "s");
    GM_registerMenuCommand ("清空配置", clearConfig, "c");

    window.addEventListener('load', function() {
        addClearButton();
        if (isCreateTokenPage()) {
            helpCreateToken();
        }
    });

})();