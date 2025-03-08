let currentFileToDelete = null;

// 載入文檔列表
async function loadDocuments() {
    try {
        const response = await fetch('/documents');
        const documents = await response.json();
        const container = document.getElementById('documents');
        container.innerHTML = documents.map(doc => `
            <div class="doc-card">
                <span class="text-sm text-gray-800" title="${doc}">${doc}</span>
                <div class="flex items-center">
                    <button onclick="showPreviewModal('${doc}')" class="preview-btn" title="預覽文檔">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                    </button>
                    <button onclick="event.stopPropagation(); showDeleteModal('${doc}')" class="delete-btn" title="刪除文檔">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');

        // 初始化 modal 事件監聽
        initializeModalEvents();
    } catch (error) {
        console.error('Error loading documents:', error);
        alert('載入文檔列表失敗');
    }
}

// Modal 相關功能
async function showPreviewModal(filename) {
    try {
        const response = await fetch(`/documents/${encodeURIComponent(filename)}/content`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const content = await response.text();
        
        document.getElementById('previewTitle').textContent = filename;
        document.getElementById('previewContent').innerHTML = marked.parse(content);
        
        const modal = document.getElementById('previewModal');
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    } catch (error) {
        console.error('Error loading document content:', error);
        alert(`無法載入文檔內容: ${error.message}`);
    }
}

function initializeModalEvents() {
    // 關閉按鈕事件
    document.querySelectorAll('[data-modal-hide="previewModal"]').forEach(button => {
        button.addEventListener('click', closePreviewModal);
    });

    // 點擊背景關閉
    const modal = document.getElementById('previewModal');
    modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.classList.contains('fixed')) {
            closePreviewModal();
        }
    });

    // ESC 鍵關閉
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !document.getElementById('previewModal').getAttribute('aria-hidden') === 'true') {
            closePreviewModal();
        }
    });
}

function closePreviewModal() {
    const modal = document.getElementById('previewModal');
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

// 文件上傳相關功能
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const selectFileBtn = document.getElementById('selectFileBtn');

selectFileBtn.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', handleFileSelect);

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFileUpload(files[0]);
    }
});

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        handleFileUpload(file);
    }
}

async function handleFileUpload(file) {
    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            alert('文件上傳成功');
            fileInput.value = '';
            loadDocuments();
        } else {
            const error = await response.json();
            alert(error.detail || '上傳失敗');
        }
    } catch (error) {
        console.error('Error uploading file:', error);
        alert('上傳失敗');
    }
}

// 問答功能
document.getElementById('submitQuestion').addEventListener('click', async (e) => {
    e.preventDefault();
    const question = document.getElementById('question').value.trim();
    const similarity = parseFloat(document.getElementById('similarity').value);
    
    if (!question) {
        alert('請輸入問題');
        return;
    }
    
    try {
        const submitButton = document.getElementById('submitQuestion');
        submitButton.disabled = true;
        submitButton.textContent = '處理中...';
        
        const response = await fetch('/query', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: question,
                similarity_threshold: similarity
            })
        });

        const result = await response.json();
        const answerDiv = document.getElementById('answer');
        const answerText = document.getElementById('answerText');
        const sourcesList = document.getElementById('sourcesList');

        answerText.innerHTML = marked.parse(result.answer);
        sourcesList.innerHTML = result.sources.map(source => 
            `<li class="hover:text-blue-600">${source}</li>`
        ).join('');
        
        answerDiv.classList.remove('hidden');
        answerDiv.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        console.error('Error querying:', error);
        alert('查詢失敗');
    } finally {
        const submitButton = document.getElementById('submitQuestion');
        submitButton.disabled = false;
        submitButton.textContent = '提交問題';
    }
});

document.getElementById('similarity').addEventListener('input', function(e) {
    document.getElementById('similarityValue').textContent = e.target.value;
});

// 刪除文檔相關功能
function showDeleteModal(filename) {
    currentFileToDelete = filename;
    document.getElementById('deleteModal').classList.remove('hidden');
    document.getElementById('adminPassword').value = '';
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.add('hidden');
    currentFileToDelete = null;
}

async function confirmDelete() {
    if (!currentFileToDelete) return;

    const password = document.getElementById('adminPassword').value;
    if (!password) {
        alert('請輸入管理員密碼');
        return;
    }

    try {
        const response = await fetch(`/documents/${currentFileToDelete}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `password=${encodeURIComponent(password)}`
        });

        if (response.ok) {
            alert('文件刪除成功');
            closeDeleteModal();
            loadDocuments();
        } else {
            const error = await response.json();
            alert(error.detail || '刪除失敗');
        }
    } catch (error) {
        console.error('Error deleting document:', error);
        alert('刪除失敗');
    }
}

// 初始化
loadDocuments(); 