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
        queryForm: document.getElementById('queryForm'),
        question: document.getElementById('question'),
        similarity: document.getElementById('similarity'),
        similarityValue: document.getElementById('similarityValue'),
        answer: document.getElementById('answer'),
        answerText: document.getElementById('answerText'),
        sources: document.getElementById('sources'),
        sourcesList: document.getElementById('sourcesList'),
        documents: document.getElementById('documents'),
        dropZone: document.getElementById('dropZone'),
        fileInput: document.getElementById('fileInput'),
        selectFileBtn: document.getElementById('selectFileBtn'),
        uploadForm: document.getElementById('uploadForm'),
        adminPassword: document.getElementById('adminPassword'),
        navbarToggle: document.querySelector('[data-collapse-toggle="navbar-main"]'),
        navbarMenu: document.getElementById('navbar-main'),
        textInputForm: document.getElementById('textInputForm'),
        docTitleInput: document.getElementById('docTitle'),
        docContentInput: document.getElementById('docContent'),
        previewContentBtn: document.getElementById('previewContentBtn'),
        saveContentBtn: document.getElementById('saveContentBtn')
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
            console.log('開始發送查詢請求:', { question, similarity });
            try {
                const response = await fetch('/query', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        text: question,
                        similarity_threshold: similarity 
                    })
                });
                console.log('查詢響應狀態:', response.status);
                
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('查詢失敗，服務器返回:', errorText);
                    throw new Error(errorText || `HTTP error! status: ${response.status}`);
                }
                
                const result = await response.json();
                console.log('查詢結果:', result);
                return result;
            } catch (error) {
                console.error('查詢失敗:', error);
                throw error;
            }
        },

        async getDocuments() {
            console.log('開始獲取文檔列表');
            try {
                const response = await fetch('/documents');
                console.log('API 響應狀態:', response.status);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                console.log('獲取到的文檔列表數據:', data);
                return data;
            } catch (error) {
                console.error('獲取文檔列表失敗:', error);
                throw error;
            }
        },

        async getDocumentContent(filename) {
            try {
                const response = await fetch(`/documents/${encodeURIComponent(filename)}/content`);
                if (!response.ok) {
                    throw new Error(await response.text());
                }
                return await response.text();
            } catch (error) {
                console.error('獲取文檔內容失敗:', error);
                throw error;
            }
        },

        async deleteDocument(filename, password) {
            try {
                const response = await fetch(`/documents/${filename}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });
                if (!response.ok) {
                    throw new Error(await response.text());
                }
                return true;
            } catch (error) {
                console.error('刪除文檔失敗:', error);
                throw error;
            }
        },

        async uploadDocument(file) {
            try {
                const formData = new FormData();
                formData.append('file', file);
                const response = await fetch('/documents', {
                    method: 'POST',
                    body: formData
                });
                if (!response.ok) {
                    throw new Error(await response.text());
                }
                return true;
            } catch (error) {
                console.error('上傳文檔失敗:', error);
                throw error;
            }
        }
    };

    // UI 更新
    const ui = {
        updateSimilarityValue() {
            elements.similarityValue.textContent = elements.similarity.value;
        },

        showAnswer(answer, sources) {
            console.log('顯示回答:', { answer, sources });
            try {
                // 使用 markdown-it 而不是 marked
                elements.answerText.innerHTML = window.md.render(answer);
                elements.sourcesList.innerHTML = sources
                    .map(source => `<li>${source}</li>`)
                    .join('');
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

        async refreshDocumentList() {
            console.log('開始刷新文檔列表');
            try {
                const documents = await api.getDocuments();
                console.log('獲取到的文檔列表:', documents);

                // 檢查 documents 的類型和內容
                console.log('documents 類型:', typeof documents);
                console.log('是否為數組:', Array.isArray(documents));

                // 確保 documents 存在且是數組
                if (!documents) {
                    console.error('documents 為空');
                    throw new Error('未獲取到文檔列表數據');
                }

                const documentsList = Array.isArray(documents) ? documents : [];
                console.log('處理後的文檔列表:', documentsList);
                
                if (documentsList.length > 0) {
                    console.log('開始生成文檔卡片 HTML');
                    const documentCards = documentsList
                        .map(filename => {
                            console.log('處理文檔:', filename);
                            return `
                                <div class="doc-card">
                                    <div class="doc-card-content">
                                        <span class="doc-card-title">${filename}</span>
                                        <div class="doc-card-actions">
                                            <button class="action-btn preview-btn" onclick="handlePreview('${filename}')" title="預覽">
                                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                                                </svg>
                                            </button>
                                            <button class="action-btn delete-btn" onclick="handleDelete('${filename}')" title="刪除">
                                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            `;
                        })
                        .join('');
                    
                    console.log('生成的 HTML:', documentCards);
                    console.log('documents 元素:', elements.documents);
                    elements.documents.innerHTML = documentCards;
                    console.log('HTML 已更新');
                } else {
                    console.log('文檔列表為空，顯示提示信息');
                    elements.documents.innerHTML = `
                        <div class="text-center text-gray-500 py-8">
                            尚無文檔，請上傳新文檔
                        </div>
                    `;
                }
            } catch (error) {
                console.error('刷新文檔列表失敗:', error);
                elements.documents.innerHTML = `
                    <div class="text-center text-red-500 py-8">
                        載入文檔列表失敗：${error.message}
                    </div>
                `;
            }
        },

        showError(message) {
            console.error('顯示錯誤:', message);
            alert(message);
        }
    };

    // 導航欄控制
    const navbar = {
        toggle: () => {
            elements.navbarMenu.classList.toggle('hidden');
        },
        hide: () => {
            elements.navbarMenu.classList.add('hidden');
        }
    };

    // 添加導航欄事件監聽
    function initializeNavbar() {
        // 菜單切換按鈕
        elements.navbarToggle.addEventListener('click', navbar.toggle);

        // 點擊導航項時關閉菜單（移動端）
        elements.navbarMenu.querySelectorAll('a').forEach(link => {
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
            
            ui.showAnswer(result.answer, result.sources || []);
        } catch (error) {
            console.error('處理查詢失敗:', error);
            ui.showError(error.message || '查詢失敗，請稍後重試');
        }
    }

    async function handlePreview(filename) {
        try {
            const content = await api.getDocumentContent(filename);
            modal.preview.show(filename, content);
        } catch (error) {
            ui.showError(`無法預覽文檔: ${error.message}`);
        }
    }

    function handleDelete(filename) {
        modal.delete.show(filename);
    }

    async function confirmDelete() {
        try {
            const password = elements.adminPassword.value;
            if (!password) {
                ui.showError('請輸入管理員密碼');
                return;
            }
            
            await api.deleteDocument(state.currentFile, password);
            closeDeleteModal();
            await ui.refreshDocumentList();
        } catch (error) {
            ui.showError(`刪除失敗: ${error.message}`);
        }
    }

    function closePreviewModal() {
        modal.preview.hide();
    }

    function closeDeleteModal() {
        modal.delete.hide();
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
        state.dragCounter = 0;
        elements.dropZone.classList.remove('drag-over');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileUpload(files[0]);
        }
    }

    async function handleFileUpload(file) {
        try {
            await api.uploadDocument(file);
            await ui.refreshDocumentList();
        } catch (error) {
            ui.showError('上傳失敗：' + error.message);
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
                showToast('請輸入文檔內容', 'error');
                return;
            }
            
            // 使用現有的預覽模態框顯示內容
            const previewTitle = title || '未命名文檔';
            
            // 打開預覽模態框
            const previewModal = document.getElementById('previewModal');
            const previewTitleElement = document.getElementById('previewTitle');
            const previewContentElement = document.getElementById('previewContent');
            
            previewTitleElement.textContent = previewTitle;
            
            // 使用 markdown-it 渲染內容
            if (typeof markdownit !== 'undefined') {
                const md = markdownit({
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
                previewContentElement.innerHTML = md.render(content);
            } else {
                // 如果 markdown-it 不可用，使用 marked 作為備用
                try {
                    previewContentElement.innerHTML = marked.parse(content);
                } catch (e) {
                    previewContentElement.innerHTML = `<pre>${content}</pre>`;
                }
            }
            
            // 顯示模態框
            previewModal.classList.remove('hidden');
        });

        // 表單提交事件 - 保存為文檔
        elements.textInputForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const title = elements.docTitleInput.value.trim();
            const content = elements.docContentInput.value.trim();
            
            if (!title) {
                showToast('請輸入文檔標題', 'error');
                return;
            }
            
            if (!content) {
                showToast('請輸入文檔內容', 'error');
                return;
            }
            
            // 創建 Blob 對象
            const blob = new Blob([content], { type: 'text/markdown' });
            const fileName = `${title}.md`;
            
            // 創建 FormData 對象
            const formData = new FormData();
            formData.append('file', blob, fileName);
            
            // 顯示上傳中提示
            const loadingToast = showToast('正在上傳文檔...', 'info');
            
            // 發送到服務器
            fetch('/upload', {
                method: 'POST',
                body: formData
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('上傳失敗');
                }
                return response.json();
            })
            .then(data => {
                // 顯示成功提示
                showToast('文檔上傳成功！', 'success');
                
                // 清空表單
                elements.docTitleInput.value = '';
                elements.docContentInput.value = '';
                
                // 刷新文檔列表
                fetchDocuments();
            })
            .catch(error => {
                console.error('上傳錯誤:', error);
                
                // 顯示錯誤提示
                showToast('文檔上傳失敗！', 'error');
            });
        });
    }

    // 事件監聽器
    function initializeEventListeners() {
        // 表單提交
        elements.queryForm.addEventListener('submit', handleSubmit);
        
        // 相似度滑塊
        elements.similarity.addEventListener('input', ui.updateSimilarityValue);
        
        // 文件上傳
        elements.selectFileBtn.addEventListener('click', () => elements.fileInput.click());
        elements.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFileUpload(e.target.files[0]);
            }
        });
        
        // 拖放區域
        elements.dropZone.addEventListener('dragenter', handleDragEnter);
        elements.dropZone.addEventListener('dragleave', handleDragLeave);
        elements.dropZone.addEventListener('dragover', (e) => e.preventDefault());
        elements.dropZone.addEventListener('drop', handleDrop);
        
        // 按鍵事件
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                modal.preview.hide();
                modal.delete.hide();
            }
        });
    }

    // 初始化
    async function initialize() {
        initializeEventListeners();
        initializeNavbar(); // 初始化導航欄
        await ui.refreshDocumentList();
    }

    // 初始化應用
    initialize().catch(console.error);

    // 全局函數
    window.closePreviewModal = closePreviewModal;
    window.closeDeleteModal = closeDeleteModal;
    window.handlePreview = handlePreview;
    window.handleDelete = handleDelete;
    window.confirmDelete = confirmDelete;
}); 