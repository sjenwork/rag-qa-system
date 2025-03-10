// 工具函數
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// 等待 DOM 加載完成
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM 加載完成');
    
    // 配置 markdown-it
    window.md = window.markdownit({
        html: true,
        linkify: true,
        typographer: true,
        highlight: function (str, lang) {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(str, { language: lang }).value;
                } catch (__) {}
            }
            return ''; // 使用外部默認轉義
        }
    });

    // 自定義標題渲染
    const renderer = new marked.Renderer();
    renderer.heading = (text, level) => {
        // 保留原始的 ### 符號
        const prefix = '#'.repeat(level);
        return `<h${level}>${prefix} ${text}</h${level}>`;
    };
    marked.use({ renderer });

    // DOM 元素
    const elements = {
        queryForm: $('#queryForm'),
        question: $('#question'),
        similarity: $('#similarity'),
        similarityValue: $('#similarityValue'),
        answer: $('#answer'),
        answerText: $('#answerText'),
        sources: $('#sources'),
        sourcesList: $('#sourcesList'),
        documents: $('#documents'),
        dropZone: $('#dropZone'),
        fileInput: $('#fileInput'),
        selectFileBtn: $('#selectFileBtn'),
        uploadForm: $('#uploadForm'),
        adminPassword: $('#adminPassword') || document.createElement('input'),
        navbarToggle: $('[data-collapse-toggle="navbar-main"]'),
        navbarMenu: $('#navbar-main'),
        textInputForm: $('#textInputForm'),
        docTitleInput: $('#docTitle'),
        docContentInput: $('#docContent'),
        previewContentBtn: $('#previewContentBtn'),
        saveContentBtn: $('#saveContentBtn'),
        uploadModal: $('#uploadModal'),
        uploadPassword: $('#uploadPassword'),
        previewModal: $('#previewModal'),
        previewTitle: $('#previewTitle'),
        previewContent: $('#previewContent'),
        deleteModal: $('#deleteModal'),
        loadingOverlay: $('#loadingOverlay'),  // 添加遮罩層元素
        userNameModal: $('#userNameModal'),
        userName: $('#userName'),
        confirmUserName: $('#confirmUserName'),
    };

    // 狀態管理
    let state = {
        currentFile: null,
        dragCounter: 0
    };

    // Modal 控制
    const modal = {
        preview: {
            show: (title, content) => {
                elements.previewTitle.textContent = title;
                try {
                    // 處理內容：移除開頭和結尾的引號
                    let processedContent = content;
                    if (content.startsWith('"') && content.endsWith('"')) {
                        processedContent = content.slice(1, -1);
                    }
                    
                    // 移除 [object Object] 字符串
                    processedContent = processedContent.replace(/^\[object Object\]\s*/, '');
                    
                    // 處理換行符
                    processedContent = processedContent.replace(/\\n/g, '\n');
                    
                    // 判斷是否為 Markdown 文件
                    const isMarkdown = title.toLowerCase().endsWith('.md');
                    
                    if (isMarkdown) {
                        // 按行處理 Markdown 內容
                        const lines = processedContent.split('\n');
                        const formattedContent = lines.map(line => {
                            // 保持原始格式，包括標題的 # 符號
                            const escapedLine = line
                                .replace(/</g, '&lt;')
                                .replace(/>/g, '&gt;');
                            
                            // 添加語法高亮
                            let styledLine = escapedLine;
                            
                            // 標題高亮
                            if (line.match(/^#{1,6}\s/)) {
                                styledLine = `<span class="text-blue-600 font-semibold">${escapedLine}</span>`;
                            }
                            // 列表項高亮
                            else if (line.match(/^[-*+]\s/)) {
                                styledLine = `<span class="text-gray-700">${escapedLine}</span>`;
                            }
                            // 數字列表高亮
                            else if (line.match(/^\d+\.\s/)) {
                                styledLine = `<span class="text-gray-700">${escapedLine}</span>`;
                            }
                            // 引用高亮
                            else if (line.match(/^>/)) {
                                styledLine = `<span class="text-green-600">${escapedLine}</span>`;
                            }
                            // 代碼塊
                            else if (line.match(/^```/)) {
                                styledLine = `<span class="text-purple-600">${escapedLine}</span>`;
                            }
                            // 行內代碼
                            else {
                                styledLine = styledLine.replace(/`([^`]+)`/g, '<span class="text-purple-600 bg-gray-100 px-1 rounded">`$1`</span>');
                            }

                            return `<div class="editor-line">${styledLine}</div>`;
                        }).join('');

                        elements.previewContent.innerHTML = `
                            <div class="editor-content font-mono text-sm leading-6">
                                ${formattedContent}
                            </div>
                        `;
                    } else {
                        // 普通文本文件保持原樣顯示
                        const lines = processedContent.split('\n');
                        const formattedContent = lines.map(line => {
                            const lineContent = line
                                .replace(/</g, '&lt;')
                                .replace(/>/g, '&gt;');
                            
                            return `<div class="editor-line">${lineContent}</div>`;
                        }).join('');

                        elements.previewContent.innerHTML = `
                            <div class="editor-content font-mono text-sm leading-6">
                                ${formattedContent}
                            </div>
                        `;
                    }
                    
                    elements.previewModal.classList.remove('hidden');
                } catch (error) {
                    console.error('渲染失敗:', error);
                    elements.previewContent.textContent = content;
                    elements.previewModal.classList.remove('hidden');
                }
            },
            hide: () => {
                elements.previewModal.classList.add('hidden');
            }
        },
        delete: {
            show: (filename) => {
                state.currentFile = filename;
                elements.deleteModal.classList.remove('hidden');
                elements.adminPassword.value = '';
                elements.adminPassword.focus();
            },
            hide: () => {
                elements.deleteModal.classList.add('hidden');
                state.currentFile = null;
            }
        }
    };

    // API 請求
    const api = {
        async query(question, similarity) {
            try {
                const response = await fetch('/ai/query', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        text: question,
                        similarity_threshold: similarity
                    })
                });
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('查詢失敗，伺服器回應:', errorText);
                    throw new Error(errorText);
                }
                return await response.json();
            } catch (error) {
                console.error('查詢失敗:', error);
                throw error;
            }
        },

        async getDocuments() {
            try {
                const response = await fetch('/ai/documents');
                if (!response.ok) {
                    throw new Error(await response.text());
                }
                return await response.json();
            } catch (error) {
                console.error('獲取文本列表失敗:', error);
                throw error;
            }
        },

        async getDocumentContent(filename) {
            try {
                console.log('獲取文本內容:', filename);
                const response = await fetch(`/ai/documents/${encodeURIComponent(filename)}/content`);
                if (!response.ok) {
                    throw new Error(await response.text());
                }
                return await response.text();
            } catch (error) {
                console.error('獲取文本內容失敗:', error);
                throw error;
            }
        },

        async deleteDocument(filename, password) {
            try {
                console.log('刪除文本:', filename, '密碼:', password);
                
                // 使用 FormData 而不是 JSON
                const formData = new FormData();
                formData.append('password', password);
                
                const response = await fetch(`/ai/documents/${filename}`, {
                    method: 'DELETE',
                    body: formData
                });
                
                if (!response.ok) {
                    const contentType = response.headers.get('content-type');
                    if (contentType && contentType.includes('application/json')) {
                        const errorJson = await response.json();
                        console.error('刪除文本失敗，伺服器回應 JSON:', errorJson);
                        throw new Error(JSON.stringify(errorJson));
                    } else {
                        const errorText = await response.text();
                        console.error('刪除文本失敗，伺服器回應文本:', errorText);
                        throw new Error(errorText);
                    }
                }
                
                return true;
            } catch (error) {
                console.error('刪除文本失敗:', error);
                throw error;
            }
        },

        async uploadDocument(file) {
            return new Promise((resolve, reject) => {
                showUploadModal();
                
                const confirmBtn = elements.uploadModal.querySelector('.confirm-btn');
                const cancelBtn = elements.uploadModal.querySelector('.cancel-btn');
                
                const cleanup = () => {
                    confirmBtn.onclick = null;
                    cancelBtn.onclick = null;
                    closeUploadModal();
                };
                
                const handleCancel = () => {
                    cleanup();
                    reject(new Error('上傳已取消'));
                };
                
                const handleConfirm = async () => {
                    const password = elements.uploadPassword.value;
                    if (!password) {
                        showToast('請輸入密碼', 'error');
                        return;
                    }
                    
                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('password', password);
                    
                    try {
                        const response = await fetch('/ai/upload', {
                            method: 'POST',
                            body: formData
                        });
                        
                        if (!response.ok) {
                            const error = await response.text();
                            throw new Error(error);
                        }
                        
                        cleanup();
                        resolve(await response.json());
                    } catch (error) {
                        cleanup();
                        reject(error);
                    }
                };
                
                // 綁定事件
                confirmBtn.onclick = handleConfirm;
                cancelBtn.onclick = handleCancel;
                
                // ESC 鍵關閉
                const handleEsc = (e) => {
                    if (e.key === 'Escape') {
                        handleCancel();
                    }
                };
                document.addEventListener('keydown', handleEsc);
                
                // Enter 鍵確認
                elements.uploadPassword.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        handleConfirm();
                    }
                };
            });
        }
    };

    // UI 控制
    const ui = {
        updateSimilarityValue() {
            if (elements.similarityValue) {
                elements.similarityValue.textContent = elements.similarity.value;
            }
        },

        showLoading() {
            if (elements.loadingOverlay) {
                elements.loadingOverlay.classList.remove('hidden');
            }
        },

        hideLoading() {
            if (elements.loadingOverlay) {
                elements.loadingOverlay.classList.add('hidden');
            }
        },

        showAnswer(answer, sources = [], enhancedPrompt = '') {
            if (!elements.answerText || !elements.answer) {
                console.error('找不到回答區域元素');
                return;
            }

            try {
                // 來源標題
                const sourcesTitleHtml = sources.length > 0 ? `
                    <h3 class="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">參考來源</h3>
                ` : '';

                // 來源內容
                const sourcesContentHtml = sources.length > 0 ? `
                    <div class="mb-6 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
                        <ul class="list-disc pl-5 text-sm text-gray-600 dark:text-gray-400">
                            ${sources.map(source => `<li>${source}</li>`).join('')}
                        </ul>
                    </div>
                ` : '';

                // 強化後的提示詞標題
                const promptTitleHtml = enhancedPrompt ? `
                    <h3 class="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">強化後的提示詞</h3>
                ` : '';

                // 強化後的提示詞內容
                const promptContentHtml = enhancedPrompt ? `
                    <div class="mb-6 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
                        <div class="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">${enhancedPrompt}</div>
                    </div>
                ` : '';

                // 回答標題
                const answerTitleHtml = `
                    <h3 class="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">回答</h3>
                `;

                // 回答內容
                const answerContentHtml = `
                    <div class="mb-6 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
                        <div class="prose dark:prose-invert max-w-none">
                            ${window.md.render(answer)}
                        </div>
                    </div>
                `;

                // 組合所有內容
                elements.answerText.innerHTML = `
                    ${sourcesTitleHtml}
                    ${sourcesContentHtml}
                    ${answerTitleHtml}
                    ${answerContentHtml}
                    ${promptTitleHtml}
                    ${promptContentHtml}
                `;
                elements.answer.classList.remove('hidden');
            } catch (error) {
                console.error('渲染回答失敗:', error);
                // 如果渲染失敗，使用純文本顯示
                elements.answerText.textContent = answer;
                if (elements.sourcesList) {
                    elements.sourcesList.innerHTML = sources
                        .map(source => `<li>${source}</li>`)
                        .join('');
                }
                elements.answer.classList.remove('hidden');
            }
        },

        showError(message) {
            console.error('顯示錯誤:', message);
            showToast(message, 'error');
        },

        refreshDocumentList(documents) {
            if (!elements.documents) {
                console.error('找不到文檔列表元素');
                return;
            }

            try {
                // 清空現有列表
                elements.documents.innerHTML = '';

                if (!documents || documents.length === 0) {
                    elements.documents.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-center py-4">目前沒有任何文本</p>';
                    return;
                }

                // 創建文檔列表
                const ul = document.createElement('ul');
                ul.className = 'space-y-2';

                documents.forEach(doc => {
                    const li = document.createElement('li');
                    li.className = 'flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow';

                    const docInfo = document.createElement('div');
                    docInfo.className = 'flex-1';

                    const docName = document.createElement('h3');
                    docName.className = 'text-gray-900 dark:text-white font-medium';
                    docName.textContent = doc;

                    docInfo.appendChild(docName);

                    const actions = document.createElement('div');
                    actions.className = 'flex space-x-2';

                    // 預覽按鈕
                    const previewBtn = document.createElement('button');
                    previewBtn.className = 'text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center space-x-1';
                    previewBtn.innerHTML = '<i class="fas fa-eye"></i><span>檢視</span>';
                    previewBtn.onclick = () => handlePreview(doc);
                    previewBtn.title = '預覽';

                    // 刪除按鈕
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 flex items-center space-x-1';
                    deleteBtn.innerHTML = '<i class="fas fa-trash"></i><span>刪除</span>';
                    deleteBtn.onclick = () => handleDelete(doc);
                    deleteBtn.title = '刪除';

                    actions.appendChild(previewBtn);
                    actions.appendChild(deleteBtn);

                    li.appendChild(docInfo);
                    li.appendChild(actions);
                    ul.appendChild(li);
                });

                elements.documents.appendChild(ul);
            } catch (error) {
                console.error('更新文檔列表失敗:', error);
                showToast('更新文檔列表失敗: ' + error.message, 'error');
            }
        },

        showUserNameModal() {
            if (elements.userNameModal) {
                elements.userNameModal.classList.remove('hidden');
                elements.userName.focus();
            }
        },
        
        hideUserNameModal() {
            if (elements.userNameModal) {
                elements.userNameModal.classList.add('hidden');
            }
        }
    };

    // 導航欄控制
    const navbar = {
        toggle: () => {
            elements.navbarMenu?.classList.toggle('hidden');
        },
        hide: () => {
            elements.navbarMenu?.classList.add('hidden');
        }
    };

    // 添加導航欄事件監聽
    function initializeNavbar() {
        console.log('初始化導航欄');
        
        // 檢查必要的元素是否存在
        if (!elements.navbarToggle || !elements.navbarMenu) {
            console.log('導航欄元素未找到，跳過初始化');
            return;
        }

        try {
            // 菜單切換按鈕
            elements.navbarToggle.addEventListener('click', navbar.toggle);

            // 點擊導航項時關閉菜單（移動端）
            const navLinks = elements.navbarMenu.querySelectorAll('a');
            navLinks.forEach(link => {
                link.addEventListener('click', () => {
                    if (window.innerWidth < 768) { // md 斷點
                        navbar.hide();
                    }
                });
            });

            // 點擊外部時關閉菜單
            document.addEventListener('click', (event) => {
                const isNavbarClick = event.target.closest('#navbar-main') || 
                                    event.target.closest('[data-collapse-toggle="navbar-main"]');
                if (!isNavbarClick && window.innerWidth < 768) {
                    navbar.hide();
                }
            });

            console.log('導航欄初始化完成');
        } catch (error) {
            console.error('導航欄初始化失敗:', error);
        }
    }

    // 處理表單提交
    async function handleSubmit(event) {
        event.preventDefault();
        const question = elements.question.value.trim();
        const similarity = parseFloat(elements.similarity.value);
        const deviceId = localStorage.getItem('deviceId');
        const userName = localStorage.getItem('userName');

        if (!question) {
            ui.showError('請輸入問題');
            return;
        }

        try {
            ui.showLoading();
            const result = await api.query(question, similarity);
            ui.showAnswer(result.answer, result.sources, result.enhanced_prompt);
            
            // 記錄查詢行為
            fetch('/ai/log_action', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    device_id: deviceId,
                    user_name: userName,
                    action: 'query',
                    details: { question, similarity }
                })
            }).catch(console.error);
        } catch (error) {
            console.error('查詢失敗:', error);
            ui.showError('查詢失敗：' + (error.message || '請稍後重試'));
        } finally {
            ui.hideLoading();
        }
    }

    // 強制刷新樣式
    function forceStyleRefresh() {
        // 通過添加和移除一個類來強制瀏覽器重新計算樣式
        document.body.classList.add('style-refresh');
        setTimeout(() => {
            document.body.classList.remove('style-refresh');
        }, 10);
    }

    // 修改 handlePreview 函數，添加強制刷新樣式
    async function handlePreview(filename) {
        console.log('預覽文本:', filename);
        try {
            const content = await api.getDocumentContent(filename);
            console.log('獲取到的文本內容:', content);
            
            // 打開預覽模態框
            const previewModal = document.getElementById('previewModal');
            const previewTitle = document.getElementById('previewTitle');
            const previewContent = document.getElementById('previewContent');
            
            if (!previewModal || !previewTitle || !previewContent) {
                console.error('找不到預覽模態框元素');
                showToast('預覽模態框初始化失敗', 'error');
                return;
            }
            
            previewTitle.textContent = filename;
            
            // 使用 VSCode 樣式顯示內容
            // 確保內容中的 \n 被正確處理為換行，並移除開頭和結尾的引號
            let processedContent = content.replace(/\\n/g, '\n');
            
            // 移除開頭和結尾的引號
            if (processedContent.startsWith('"') && processedContent.endsWith('"')) {
                processedContent = processedContent.substring(1, processedContent.length - 1);
            }
            
            // 移除 [object Object] 前綴
            processedContent = processedContent.replace(/^\[object Object\]/, '');
            
            const lines = processedContent.split('\n');
            let htmlContent = '<div class="editor-content">';
            
            lines.forEach((line, index) => {
                // 處理標題行
                if (line.startsWith('#')) {
                    try {
                        const headingLevel = line.match(/^#+/)[0].length;
                        const headingText = line.replace(/^#+\s*/, '');
                        htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span class="text-blue-600">${line.substring(0, headingLevel)}</span><span class="text-blue-600">${headingText}</span></div>`;
                    } catch (e) {
                        // 如果正則表達式匹配失敗，使用普通文本顯示
                        htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span>${line}</span></div>`;
                    }
                } 
                // 處理列表項
                else if (line.match(/^\s*[\-\*\+]\s/)) {
                    try {
                        const listMarker = line.match(/^\s*[\-\*\+]\s/)[0];
                        const listText = line.replace(/^\s*[\-\*\+]\s/, '');
                        htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span class="text-gray-700">${listMarker}</span><span>${listText}</span></div>`;
                    } catch (e) {
                        htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span>${line}</span></div>`;
                    }
                }
                // 處理數字列表
                else if (line.match(/^\s*\d+\.\s/)) {
                    try {
                        const listMarker = line.match(/^\s*\d+\.\s/)[0];
                        const listText = line.replace(/^\s*\d+\.\s/, '');
                        htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span class="text-gray-700">${listMarker}</span><span>${listText}</span></div>`;
                    } catch (e) {
                        htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span>${line}</span></div>`;
                    }
                }
                // 處理引用
                else if (line.startsWith('>')) {
                    try {
                        const quoteMarker = line.match(/^>\s*/)[0];
                        const quoteText = line.replace(/^>\s*/, '');
                        htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span class="text-green-600">${quoteMarker}</span><span class="text-green-600">${quoteText}</span></div>`;
                    } catch (e) {
                        htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span>${line}</span></div>`;
                    }
                }
                // 處理代碼塊
                else if (line.match(/^```/)) {
                    htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span class="text-purple-600">${line}</span></div>`;
                }
                // 普通文本
                else {
                    htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span>${line}</span></div>`;
                }
            });
            
            htmlContent += '</div>';
            previewContent.innerHTML = htmlContent;
            console.log('設置預覽內容完成');
            
            // 顯示模態框並鎖定背景滾動
            previewModal.classList.remove('hidden');
            previewModal.classList.add('active');
            document.body.classList.add('modal-open');
            
            // 強制刷新樣式
            forceStyleRefresh();
            
            console.log('顯示預覽模態框');
        } catch (error) {
            console.error('預覽文本失敗:', error);
            showToast('預覽文本失敗: ' + error.message, 'error');
        }
    }

    function handleDelete(filename) {
        console.log('準備刪除文本:', filename);
        // 打開刪除確認模態框
        const deleteModal = document.getElementById('deleteModal');
        
        // 存儲當前要刪除的文件名
        deleteModal.setAttribute('data-filename', filename);
        
        // 清空密碼輸入框
        elements.adminPassword.value = '';
        
        // 顯示模態框並鎖定背景滾動
        deleteModal.classList.remove('hidden');
        deleteModal.classList.add('active');
        document.body.classList.add('modal-open');
        
        // 強制刷新樣式
        forceStyleRefresh();
    }

    function closeDeleteModal() {
        const deleteModal = document.getElementById('deleteModal');
        if (deleteModal) {
            deleteModal.classList.remove('active');
            deleteModal.classList.add('hidden');
            // 解除背景滾動鎖定
            document.body.classList.remove('modal-open');
            // 清空密碼輸入框
            elements.adminPassword.value = '';
        } else {
            console.error('找不到刪除模態框元素');
        }
    }

    async function confirmDelete() {
        const deleteModal = document.getElementById('deleteModal');
        const filename = deleteModal.getAttribute('data-filename');
        const password = elements.adminPassword.value;
        
        if (!password) {
            showToast('請輸入管理員密碼', 'error');
            return;
        }
        
        try {
            console.log('確認刪除文本:', filename, '使用密碼:', password);
            
            // 顯示刪除中提示
            showToast('正在刪除文本...', 'info');
            
            await api.deleteDocument(filename, password);
            closeDeleteModal();
            showToast('文本刪除成功', 'success');
            
            // 刷新文本列表
            const documents = await api.getDocuments();
            ui.refreshDocumentList(documents);
        } catch (error) {
            console.error('刪除文本失敗:', error);
            let errorMsg = '刪除文本失敗';
            
            // 嘗試解析錯誤信息
            try {
                if (error.message.includes('密碼錯誤')) {
                    errorMsg = '密碼錯誤，請重試';
                } else if (error.message.includes('文件不存在')) {
                    errorMsg = '文件不存在';
                } else {
                    const errorObj = JSON.parse(error.message);
                    if (errorObj.detail) {
                        if (Array.isArray(errorObj.detail)) {
                            errorMsg += ': ' + errorObj.detail.map(d => d.msg).join(', ');
                        } else {
                            errorMsg += ': ' + errorObj.detail;
                        }
                    }
                }
            } catch (e) {
                // 如果不是 JSON 格式的錯誤，直接使用錯誤信息
                if (error.message) {
                    errorMsg += ': ' + error.message;
                }
            }
            
            showToast(errorMsg, 'error');
        }
    }

    function closePreviewModal() {
        console.log('關閉預覽模態框');
        const previewModal = document.getElementById('previewModal');
        if (previewModal) {
            previewModal.classList.remove('active');
            previewModal.classList.add('hidden');
            // 解除背景滾動鎖定
            document.body.classList.remove('modal-open');
        } else {
            console.error('找不到預覽模態框元素');
        }
    }

    // 文件拖放處理
    function handleDragEnter(e) {
        e.preventDefault();
        state.dragCounter++;
        elements.dropZone.classList.add('drag-over');
    }

    function handleDragLeave(e) {
        e.preventDefault();
        state.dragCounter--;
        if (state.dragCounter === 0) {
            elements.dropZone.classList.remove('drag-over');
        }
    }

    function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        
        elements.dropZone.classList.remove('drag-over');
        
        if (e.dataTransfer.files.length) {
            const file = e.dataTransfer.files[0];
            handleFileUpload(file);
        }
    }

    async function handleFileUpload(file) {
        try {
            showToast('正在上傳文本...', 'info');
            await api.uploadDocument(file);
            showToast('文本上傳成功！', 'success');
            
            // 刷新文本列表
            const documents = await api.getDocuments();
            ui.refreshDocumentList(documents);
        } catch (error) {
            console.error('上傳文本失敗:', error);
            showToast('上傳文本失敗: ' + error.message, 'error');
        }
    }

    // 輔助函數 - 顯示提示框
    function showToast(message, type = 'info', duration = 3000) {
        // 移除所有現有的提示框
        document.querySelectorAll('.toast-notification').forEach(toast => {
            document.body.removeChild(toast);
        });
        
        // 創建新的提示框
        const toast = document.createElement('div');
        toast.className = `toast-notification toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        // 設置定時器移除提示框
        setTimeout(() => {
            if (document.body.contains(toast)) {
                document.body.removeChild(toast);
            }
        }, duration);
        
        return toast;
    }

    // 文本輸入和保存為 Markdown 文件
    if (elements.textInputForm && elements.previewContentBtn && elements.saveContentBtn) {
        // 預覽內容按鈕點擊事件
        elements.previewContentBtn.addEventListener('click', function() {
            const title = elements.docTitleInput.value.trim();
            const content = elements.docContentInput.value.trim();
            
            if (!content) {
                showToast('請輸入文本內容', 'error');
                return;
            }
            
            // 使用現有的預覽模態框顯示內容
            const previewTitle = title || '未命名文本';
            
            // 打開預覽模態框
            const previewModal = document.getElementById('previewModal');
            const previewTitleElement = document.getElementById('previewTitle');
            const previewContentElement = document.getElementById('previewContent');
            
            previewTitleElement.textContent = previewTitle;
            
            // 使用 VSCode 樣式顯示內容
            // 確保內容中的 \n 被正確處理為換行
            let processedContent = content.replace(/\\n/g, '\n');
            
            // 移除開頭和結尾的引號
            if (processedContent.startsWith('"') && processedContent.endsWith('"')) {
                processedContent = processedContent.substring(1, processedContent.length - 1);
            }
            
            const lines = processedContent.split('\n');
            let htmlContent = '<div class="editor-content">';
            
            lines.forEach((line, index) => {
                // 處理標題行
                if (line.startsWith('#')) {
                    try {
                        const headingLevel = line.match(/^#+/)[0].length;
                        const headingText = line.replace(/^#+\s*/, '');
                        htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span class="text-blue-600">${line.substring(0, headingLevel)}</span><span class="text-blue-600">${headingText}</span></div>`;
                    } catch (e) {
                        // 如果正則表達式匹配失敗，使用普通文本顯示
                        htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span>${line}</span></div>`;
                    }
                } 
                // 處理列表項
                else if (line.match(/^\s*[\-\*\+]\s/)) {
                    try {
                        const listMarker = line.match(/^\s*[\-\*\+]\s/)[0];
                        const listText = line.replace(/^\s*[\-\*\+]\s/, '');
                        htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span class="text-gray-700">${listMarker}</span><span>${listText}</span></div>`;
                    } catch (e) {
                        htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span>${line}</span></div>`;
                    }
                }
                // 處理數字列表
                else if (line.match(/^\s*\d+\.\s/)) {
                    try {
                        const listMarker = line.match(/^\s*\d+\.\s/)[0];
                        const listText = line.replace(/^\s*\d+\.\s/, '');
                        htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span class="text-gray-700">${listMarker}</span><span>${listText}</span></div>`;
                    } catch (e) {
                        htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span>${line}</span></div>`;
                    }
                }
                // 處理引用
                else if (line.startsWith('>')) {
                    try {
                        const quoteMarker = line.match(/^>\s*/)[0];
                        const quoteText = line.replace(/^>\s*/, '');
                        htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span class="text-green-600">${quoteMarker}</span><span class="text-green-600">${quoteText}</span></div>`;
                    } catch (e) {
                        htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span>${line}</span></div>`;
                    }
                }
                // 處理代碼塊
                else if (line.match(/^```/)) {
                    htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span class="text-purple-600">${line}</span></div>`;
                }
                // 普通文本
                else {
                    htmlContent += `<div class="editor-line"><span class="line-number">${index + 1}</span><span>${line}</span></div>`;
                }
            });
            
            htmlContent += '</div>';
            previewContentElement.innerHTML = htmlContent;
            
            // 顯示模態框並鎖定背景滾動
            previewModal.classList.remove('hidden');
            previewModal.classList.add('active');
            document.body.classList.add('modal-open');
        });

        // 表單提交事件 - 保存為文本
        elements.textInputForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const title = elements.docTitleInput.value.trim();
            const content = elements.docContentInput.value.trim();
            
            if (!title) {
                showToast('請輸入文本標題', 'error');
                return;
            }
            
            if (!content) {
                showToast('請輸入文本內容', 'error');
                return;
            }
            
            try {
                // 創建 Blob 對象
                const blob = new Blob([content], { type: 'text/markdown' });
                const fileName = `${title}.md`;
                
                // 創建 File 對象
                const file = new File([blob], fileName, { type: 'text/markdown' });
                
                // 顯示上傳中提示
                showToast('正在處理...', 'info');
                
                // 使用現有的 API 方法上傳文件
                try {
                    await api.uploadDocument(file);
                    
                    // 顯示成功提示
                    showToast('文本上傳成功！', 'success');
                    
                    // 清空表單
                    elements.docTitleInput.value = '';
                    elements.docContentInput.value = '';
                    
                    // 刷新文本列表
                    const documents = await api.getDocuments();
                    ui.refreshDocumentList(documents);
                } catch (error) {
                    if (error.message === '上傳已取消') {
                        showToast('已取消上傳', 'info');
                    } else {
                        throw error;
                    }
                }
            } catch (error) {
                console.error('上傳錯誤:', error);
                showToast('文本上傳失敗: ' + error.message, 'error');
            }
        });
    }

    // 事件監聽器
    function initializeEventListeners() {
        // 查詢表單提交
        elements.queryForm?.addEventListener('submit', handleSubmit);
        
        // 相似度滑塊變化
        elements.similarity?.addEventListener('input', ui.updateSimilarityValue);
        
        // 文件上傳區域
        if (elements.dropZone) {
            elements.dropZone.addEventListener('dragenter', handleDragEnter);
            elements.dropZone.addEventListener('dragleave', handleDragLeave);
            elements.dropZone.addEventListener('dragover', e => {
                e.preventDefault();
                e.stopPropagation();
            });
            elements.dropZone.addEventListener('drop', handleDrop);
        }
        
        // 文件選擇按鈕
        if (elements.selectFileBtn && elements.fileInput) {
            elements.selectFileBtn.addEventListener('click', () => {
                elements.fileInput.click();
            });
            
            elements.fileInput.addEventListener('change', e => {
                if (e.target.files.length > 0) {
                    handleFileUpload(e.target.files[0]);
                }
            });
        }
        
        // 導航欄切換
        if (elements.navbarToggle && elements.navbarMenu) {
            elements.navbarToggle.addEventListener('click', () => {
                elements.navbarMenu.classList.toggle('hidden');
            });
        }
        
        // 模態框關閉按鈕
        const previewModalCloseBtn = document.querySelector('#previewModal button[onclick="closePreviewModal()"]');
        if (previewModalCloseBtn) {
            console.log('找到預覽模態框關閉按鈕');
            previewModalCloseBtn.addEventListener('click', closePreviewModal);
        }
        
        const deleteModalCloseBtn = document.querySelector('#deleteModal button[onclick="closeDeleteModal()"]');
        if (deleteModalCloseBtn) {
            console.log('找到刪除模態框關閉按鈕');
            deleteModalCloseBtn.addEventListener('click', closeDeleteModal);
        }
        
        // ESC 鍵關閉模態框
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                closePreviewModal();
                closeDeleteModal();
            }
        });
        
        // 密碼輸入框按 Enter 鍵確認刪除
        elements.adminPassword?.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmDelete();
            }
        });

        // 使用者名稱確認按鈕
        elements.confirmUserName?.addEventListener('click', () => {
            const name = elements.userName.value.trim();
            if (name) {
                localStorage.setItem('userName', name);
                ui.hideUserNameModal();
            } else {
                showToast('請輸入您的稱呼', 'error');
            }
        });
        
        // 使用者名稱輸入框 Enter 鍵處理
        elements.userName?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                elements.confirmUserName.click();
            }
        });
    }

    // 初始化頁面
    async function initializePage() {
        try {
            console.log('開始初始化頁面');
            
            // 初始化 markdown-it
            window.md = window.markdownit({
                html: true,
                linkify: true,
                typographer: true,
                highlight: function (str, lang) {
                    if (lang && hljs.getLanguage(lang)) {
                        try {
                            return hljs.highlight(str, { language: lang }).value;
                        } catch (__) {}
                    }
                    return '';
                }
            });
            
            // 載入文件列表
            console.log('開始載入文件列表');
            const documents = await api.getDocuments();
            console.log('獲取到的文件列表:', documents);
            ui.refreshDocumentList(documents);
            
            // 初始化事件監聽器
            initializeEventListeners();
            
            // 初始化導航欄
            initializeNavbar();
            
            // 檢查新使用者
            checkNewUser();
            
            console.log('頁面初始化完成');
        } catch (error) {
            console.error('初始化頁面失敗:', error);
            showToast('初始化頁面失敗：' + error.message, 'error');
        }
    }

    // 初始化頁面
    initializePage();

    // 全局函數
    window.closePreviewModal = closePreviewModal;
    window.closeDeleteModal = closeDeleteModal;
    window.handlePreview = handlePreview;
    window.handleDelete = handleDelete;
    window.confirmDelete = confirmDelete;
    window.closeUploadModal = closeUploadModal;
    window.showUploadModal = showUploadModal;

    function showUploadModal() {
        elements.uploadModal.classList.remove('hidden');
        elements.uploadModal.classList.add('active');
        document.body.classList.add('modal-open');
        elements.uploadPassword.value = '';
        elements.uploadPassword.focus();
    }

    function closeUploadModal() {
        elements.uploadModal.classList.remove('active');
        elements.uploadModal.classList.add('hidden');
        document.body.classList.remove('modal-open');
        elements.uploadPassword.value = '';
    }

    // 檢查新使用者
    function checkNewUser() {
        const deviceId = localStorage.getItem('deviceId') || generateDeviceId();
        const userName = localStorage.getItem('userName');
        
        if (!userName) {
            ui.showUserNameModal();
        }
        
        // 記錄訪問
        fetch('/ai/log_visit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Device-ID': deviceId,
                'X-User-Name': userName || 'anonymous'
            },
            body: JSON.stringify({})  // 添加空的请求体
        }).catch(console.error);
    }

    // 生成裝置 ID
    function generateDeviceId() {
        const id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        localStorage.setItem('deviceId', id);
        return id;
    }
}); 