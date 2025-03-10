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
        deleteModal: $('#deleteModal')
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
                        const response = await fetch('/upload', {
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

    // UI 更新
    const ui = {
        updateSimilarityValue() {
            if (elements.similarityValue) {
                elements.similarityValue.textContent = elements.similarity.value;
            }
        },

        showAnswer(answer, sources, enhancedPrompt) {
            console.log('顯示回答:', { answer, sources, enhancedPrompt });
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
                elements.sourcesList.innerHTML = sources
                    .map(source => `<li>${source}</li>`)
                    .join('');
                elements.answer.classList.remove('hidden');
            }
        },

        refreshDocumentList(documents) {
            console.log('刷新文本列表:', documents);
            if (!elements.documents) {
                console.error('找不到文件列表容器元素');
                return;
            }
            
            if (!documents || documents.length === 0) {
                elements.documents.innerHTML = `
                    <div class="text-center py-8">
                        <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <h3 class="mt-2 text-sm font-medium text-gray-900 dark:text-gray-200">尚無文件</h3>
                        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">您可以透過上傳或直接輸入來新增文件</p>
                    </div>
                `;
                return;
            }
            
            const docHTML = documents.map(doc => `
                <div class="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm hover:shadow-md transition-shadow mb-3">
                    <div class="flex-1 min-w-0 pr-4">
                        <h3 class="text-base font-medium text-gray-900 dark:text-white truncate">
                            ${doc}
                        </h3>
                    </div>
                    <div class="flex items-center space-x-3">
                        <button onclick="handlePreview('${doc}')" 
                            class="inline-flex items-center px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/50 rounded-md hover:bg-blue-200 dark:hover:bg-blue-900 transition-colors">
                            <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            預覽
                        </button>
                        <button onclick="handleDelete('${doc}')"
                            class="inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/50 rounded-md hover:bg-red-200 dark:hover:bg-red-900 transition-colors">
                            <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            刪除
                        </button>
                    </div>
                </div>
            `).join('');
            
            elements.documents.innerHTML = docHTML;
        },

        showError(message) {
            console.error('顯示錯誤:', message);
            showToast(message, 'error');
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

    // 事件處理
    async function handleSubmit(event) {
        event.preventDefault();
        console.log('提交問題表單');
        
        const question = elements.question.value.trim();
        const similarity = parseFloat(elements.similarity.value);
        
        if (!question) {
            ui.showError('請輸入問題');
            return;
        }
        
        try {
            console.log('發送查詢:', { question, similarity });
            const result = await api.query(question, similarity);
            
            if (!result || !result.answer) {
                throw new Error('未獲得有效的回答');
            }
            
            ui.showAnswer(result.answer, result.sources || [], result.enhanced_prompt);
        } catch (error) {
            console.error('處理查詢失敗:', error);
            ui.showError(error.message || '查詢失敗，請稍後重試');
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
}); 