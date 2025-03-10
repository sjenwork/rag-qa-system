// 等待 DOM 加載完成
document.addEventListener('DOMContentLoaded', () => {
    // DOM 元素
    const elements = {
        dropZone: document.getElementById('dropZone'),
        fileInput: document.getElementById('fileInput'),
        selectFileBtn: document.getElementById('selectFileBtn'),
        uploadBtn: document.getElementById('uploadBtn'),
        selectedFileName: document.getElementById('selectedFileName'),
        results: document.getElementById('results'),
        resultsList: document.getElementById('resultsList'),
        toast: document.getElementById('toast'),
        toastMessage: document.getElementById('toastMessage')
    };

    // Toast 通知功能
    function showToast(message, type = 'info') {
        const toast = elements.toast;
        const toastMessage = elements.toastMessage;
        
        // 設置消息
        toastMessage.textContent = message;
        
        // 設置樣式
        toast.classList.remove('bg-green-500', 'bg-red-500', 'bg-blue-500');
        switch (type) {
            case 'success':
                toast.classList.add('bg-green-500');
                break;
            case 'error':
                toast.classList.add('bg-red-500');
                break;
            default:
                toast.classList.add('bg-blue-500');
        }
        
        // 顯示 toast
        toast.classList.remove('hidden');
        
        // 3秒後自動隱藏
        setTimeout(() => {
            toast.classList.add('hidden');
        }, 3000);
    }

    // 狀態管理
    let state = {
        dragCounter: 0,
        selectedFile: null
    };

    // 事件處理
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
            handleFileSelect(file);
        }
    }

    function handleFileSelect(file) {
        // 檢查文件類型
        const allowedTypes = ['image/png', 'image/jpeg', 'application/pdf'];
        if (!allowedTypes.includes(file.type)) {
            showToast('不支援的文件格式。請上傳 PNG、JPG 或 PDF 文件。', 'error');
            return;
        }

        // 保存選中的文件
        state.selectedFile = file;
        
        // 顯示文件名
        elements.selectedFileName.textContent = `已選擇：${file.name}`;
        elements.selectedFileName.classList.remove('hidden');
        
        // 顯示上傳按鈕
        elements.uploadBtn.classList.remove('hidden');
    }

    async function handleFileUpload() {
        if (!state.selectedFile) {
            showToast('請先選擇要上傳的文件。', 'error');
            return;
        }

        try {
            showToast('正在處理文件...', 'info');

            const formData = new FormData();
            formData.append('file', state.selectedFile);

            const response = await fetch('/ai/convert', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '處理文件時發生錯誤');
            }

            const result = await response.json();
            showResults(result);
            showToast('文件處理成功！', 'success');
            
            // 重置文件選擇狀態
            resetFileSelection();
        } catch (error) {
            console.error('處理文件失敗:', error);
            showToast(error.message || '處理文件失敗', 'error');
        }
    }

    function resetFileSelection() {
        state.selectedFile = null;
        elements.selectedFileName.classList.add('hidden');
        elements.selectedFileName.textContent = '';
        elements.uploadBtn.classList.add('hidden');
        elements.fileInput.value = '';
    }

    function showResults(result) {
        elements.results.classList.remove('hidden');
        
        // 清空之前的結果
        elements.resultsList.innerHTML = '';
        
        // 顯示每個表格的結果
        result.tables.forEach((table, index) => {
            const tableDiv = document.createElement('div');
            tableDiv.className = 'bg-gray-50 dark:bg-gray-700 rounded-lg p-4';
            tableDiv.innerHTML = `
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                    ${table.name}
                </h3>
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <span class="text-sm text-gray-600 dark:text-gray-300">JSON 格式</span>
                        <a href="${table.json}" class="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300" download>
                            下載
                        </a>
                    </div>
                    <div class="flex items-center justify-between">
                        <span class="text-sm text-gray-600 dark:text-gray-300">CSV 格式</span>
                        <a href="${table.csv}" class="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300" download>
                            下載
                        </a>
                    </div>
                    <div class="flex items-center justify-between">
                        <span class="text-sm text-gray-600 dark:text-gray-300">Excel 格式</span>
                        <a href="${table.excel}" class="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300" download>
                            下載
                        </a>
                    </div>
                </div>
            `;
            elements.resultsList.appendChild(tableDiv);
        });
    }

    // 初始化事件監聽器
    function initializeEventListeners() {
        // 文件拖放
        elements.dropZone.addEventListener('dragenter', handleDragEnter);
        elements.dropZone.addEventListener('dragleave', handleDragLeave);
        elements.dropZone.addEventListener('dragover', e => {
            e.preventDefault();
            e.stopPropagation();
        });
        elements.dropZone.addEventListener('drop', handleDrop);

        // 文件選擇按鈕
        elements.selectFileBtn.addEventListener('click', () => {
            elements.fileInput.click();
        });

        elements.fileInput.addEventListener('change', e => {
            if (e.target.files.length > 0) {
                handleFileSelect(e.target.files[0]);
            }
        });

        // 上傳按鈕
        elements.uploadBtn.addEventListener('click', handleFileUpload);
    }

    // 初始化
    initializeEventListeners();
}); 