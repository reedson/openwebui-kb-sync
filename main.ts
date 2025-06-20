import { App, Plugin, PluginSettingTab, Setting, TFile, Notice, requestUrl, normalizePath, Platform } from 'obsidian';

interface OpenWebUIKBSyncSettings {
    openwebuiUrl: string;
    apiToken: string;
    autoSyncEnabled: boolean;
    autoSyncInterval: number; // in minutes
    
    // ENHANCED: Track both knowledge bases AND file mappings
    syncState: Record<string, string[]>; // file path -> array of knowledge base names
    fileMapping: Record<string, OpenWebUIFileRecord>; // file path -> OpenWebUI file info
    
    debugMode: boolean; // enable detailed console logging
    
    // NEW: Mobile-aware settings
    mobile: MobileSettings;
}

// NEW: Mobile-specific settings
interface MobileSettings {
    networkBehavior: 'always' | 'wifi-preferred' | 'wifi-only';
    cellularSyncEnabled: boolean;
    cellularFileLimit: number; // bytes, 0 = no limit
    cellularAutoSyncMultiplier: number; // frequency multiplier on cellular
    maxConcurrentUploads: number;
    batchSize: number;
    enableBackgroundSync: boolean;
    batteryOptimization: boolean;
    lowBatteryThreshold: number;
}

// NEW: Enhanced file tracking
interface OpenWebUIFileRecord {
    fileId: string;           // OpenWebUI file ID
    uploadedFilename: string; // The filename we used in OpenWebUI
    contentHash: string;      // SHA-256 hash of content for change detection
    lastModified: number;     // Obsidian file mtime for change detection
    knowledgeBases: string[]; // Which KBs this file is currently in
}

const DEFAULT_SETTINGS: OpenWebUIKBSyncSettings = {
    openwebuiUrl: 'http://localhost:3000',
    apiToken: '',
    autoSyncEnabled: false,
    autoSyncInterval: 5, // 5 minutes default
    syncState: {}, // track which files are synced to which KBs
    fileMapping: {}, // ENHANCED: track OpenWebUI file mappings
    debugMode: false, // debug off by default
    mobile: {
        networkBehavior: 'wifi-preferred',
        cellularSyncEnabled: true,
        cellularFileLimit: 1024 * 1024, // 1MB default
        cellularAutoSyncMultiplier: 2, // half frequency on cellular
        maxConcurrentUploads: 2,
        batchSize: 5,
        enableBackgroundSync: false,
        batteryOptimization: true,
        lowBatteryThreshold: 15
    }
};

interface KnowledgeBase {
    id: string;
    name: string;
    description: string;
}

interface UploadedFile {
    id: string;
    filename: string;
    meta: {
        name: string;
        size: number;
    };
}

interface SyncStatus {
    synced: number;
    total: number;
    issyncing: boolean;
    error: boolean;
}

// NEW: Hash generation utility
function generateContentHash(content: string): string {
    // Simple hash function for content identification
    let hash = 0;
    if (content.length === 0) return hash.toString();
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
}

// NEW: Generate stable filename from content and original name
function generateStableFilename(originalName: string, contentHash: string): string {
    const extension = originalName.split('.').pop() || 'md';
    const baseName = originalName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9\-_]/g, '_');
    // Format: basename_contenthash.ext (truncated for readability)
    return `${baseName}_${contentHash.substring(0, 8)}.${extension}`;
}

// NEW: Convert Obsidian links to URI format for OpenWebUI compatibility
function processObsidianLinks(content: string, vaultName: string): string {
    const encodedVaultName = encodeURIComponent(vaultName);
    
    // Convert [[Internal Link|Display Text]] to markdown link with Obsidian URI
    content = content.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, filePath, displayText) => {
        // Add .md extension only if the path doesn't already have an extension
        const finalPath = filePath.includes('.') ? filePath : filePath + '.md';
        const encodedFilePath = encodeURIComponent(finalPath);
        const obsidianUri = `obsidian://open?vault=${encodedVaultName}&file=${encodedFilePath}`;
        return `[${displayText}](${obsidianUri})`;
    });
    
    // Convert [[Internal Link]] to markdown link with Obsidian URI
    content = content.replace(/\[\[([^\]]+)\]\]/g, (_, filePath) => {
        // Add .md extension only if the path doesn't already have an extension
        const finalPath = filePath.includes('.') ? filePath : filePath + '.md';
        const encodedFilePath = encodeURIComponent(finalPath);
        const obsidianUri = `obsidian://open?vault=${encodedVaultName}&file=${encodedFilePath}`;
        // Use the filename as display text
        const displayText = filePath.split('/').pop() || filePath;
        return `[${displayText}](${obsidianUri})`;
    });
    
    // Convert ![[Embedded File]] to markdown link with note about embedding
    content = content.replace(/!\[\[([^\]]+)\]\]/g, (_, filePath) => {
        // For embedded files, don't add .md extension as they could be images, PDFs, etc.
        const encodedFilePath = encodeURIComponent(filePath);
        const obsidianUri = `obsidian://open?vault=${encodedVaultName}&file=${encodedFilePath}`;
        const displayText = filePath.split('/').pop() || filePath;
        return `*Embedded: [${displayText}](${obsidianUri})*`;
    });
    
    return content;
}

// NEW: Mobile device detection and network utilities
function isMobileDevice(): boolean {
    return Platform.isMobile || 
           /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function getConnectionType(): 'wifi' | 'cellular' | 'unknown' {
    if ('connection' in navigator) {
        const connection = (navigator as any).connection;
        if (connection.type === 'wifi' || connection.effectiveType === 'wifi') {
            return 'wifi';
        }
        if (connection.type === 'cellular' || ['slow-2g', '2g', '3g', '4g'].includes(connection.effectiveType)) {
            return 'cellular';
        }
    }
    return 'unknown';
}

async function getBatteryLevel(): Promise<number> {
    if ('battery' in navigator) {
        return Promise.resolve(((navigator as any).battery).level * 100);
    }
    if ('getBattery' in navigator) {
        return (navigator as any).getBattery().then((battery: any) => battery.level * 100);
    }
    return Promise.resolve(100); // Assume full battery if can't detect
}

export default class OpenWebUIKBSyncPlugin extends Plugin {
    settings: OpenWebUIKBSyncSettings;
    statusBarItem: HTMLElement;
    autoSyncTimer: number | null = null;
    syncStatus: SyncStatus = {
        synced: 0,
        total: 0,
        issyncing: false,
        error: false
    };
    
    // NEW: Concurrency protection
    private syncMutex: boolean = false;
    
    // NEW: Knowledge base caching
    private kbCache = new Map<string, {id: string, timestamp: number}>();
    private readonly KB_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    
    // NEW: Network and mobile state
    private lastCellularWarning = 0;
    private readonly CELLULAR_WARNING_INTERVAL = 10 * 60 * 1000; // 10 minutes

    async onload() {
        await this.loadSettings();

        // MIGRATION: Ensure new properties exist
        if (!this.settings.fileMapping) {
            this.settings.fileMapping = {};
            await this.saveSettings();
        }
        
        // MIGRATION: Ensure mobile settings exist
        if (!this.settings.mobile) {
            this.settings.mobile = {
                networkBehavior: 'wifi-preferred',
                cellularSyncEnabled: true,
                cellularFileLimit: 1024 * 1024, // 1MB default
                cellularAutoSyncMultiplier: 2, // half frequency on cellular
                maxConcurrentUploads: 2,
                batchSize: 5,
                enableBackgroundSync: false,
                batteryOptimization: true,
                lowBatteryThreshold: 15
            };
            await this.saveSettings();
        }

        // Add CSS for status bar styling
        this.addStatusBarCSS();

        // Add ribbon icon
        const ribbonIconEl = this.addRibbonIcon('cloud-upload', 'Sync to OpenWebUI Knowledge Base', async () => {
            await this.syncToKnowledgeBase();
        });
        ribbonIconEl.addClass('openwebui-kb-sync-ribbon-class');

        // Add status bar item
        this.statusBarItem = this.addStatusBarItem();
        this.updateStatusBar();

        // Add settings tab
        this.addSettingTab(new OpenWebUIKBSyncSettingTab(this.app, this));

        // Start auto-sync if enabled
        this.startAutoSync();

        this.debug('OpenWebUI KB Sync plugin loaded');
    }

    onunload() {
        // Clean up auto-sync timer
        this.stopAutoSync();
        
        // Remove injected CSS
        this.removeStatusBarCSS();
        
        // SAFETY: If plugin is unloaded during sync, release mutex
        if (this.syncMutex) {
            this.debug('Plugin unloading during sync, releasing mutex');
            this.syncMutex = false;
        }
        
        // Reset sync status to prevent any stale state
        this.syncStatus = {
            synced: 0,
            total: 0,
            issyncing: false,
            error: false
        };
        
        this.debug('OpenWebUI KB Sync plugin unloaded - all resources cleaned up');
    }

    addStatusBarCSS() {
        // Inject CSS for status bar styling using Obsidian CSS variables
        const css = `
            .kb-status-ok {
                color: var(--text-accent) !important;
                font-weight: 500 !important;
            }
            .kb-status-error {
                color: var(--text-error) !important;
                font-weight: 500 !important;
            }
            .kb-status-syncing {
                color: var(--text-accent-hover) !important;
                font-weight: 500 !important;
                animation: kb-pulse 1.5s ease-in-out infinite alternate;
            }
            @keyframes kb-pulse {
                from { opacity: 0.6; }
                to { opacity: 1.0; }
            }
            
            /* File mapping styles */
            .kb-file-mapping-details {
                background-color: var(--background-secondary);
                border: 1px solid var(--background-modifier-border);
                border-radius: var(--radius-s);
                padding: var(--size-4-2);
                font-family: var(--font-monospace);
                font-size: var(--font-smaller);
                max-height: 300px;
                overflow-y: auto;
                margin-top: var(--size-2-3);
            }
            
            .kb-sync-state-details {
                background-color: var(--background-primary-alt);
                border: 1px solid var(--background-modifier-border);
                border-radius: var(--radius-s);
                padding: var(--size-4-2);
                font-family: var(--font-monospace);
                font-size: var(--font-smaller);
                max-height: 200px;
                overflow-y: auto;
                margin-top: var(--size-2-3);
            }
            
            .kb-sync-status {
                color: var(--text-accent);
            }
            
            /* Ribbon icon styling - remove default colors */
            .openwebui-kb-sync-ribbon-class {
                color: var(--icon-color) !important;
            }
        `;
        
        const style = document.createElement('style');
        style.id = 'openwebui-kb-sync-status-css';
        style.textContent = css;
        document.head.appendChild(style);
    }

    removeStatusBarCSS() {
        const existingStyle = document.getElementById('openwebui-kb-sync-status-css');
        if (existingStyle) {
            existingStyle.remove();
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        // Update status bar to reflect configuration changes
        this.updateStatusBar();
        // Restart auto-sync with new settings
        this.startAutoSync();
    }

    // Debug logging helper - only logs if debug mode is enabled
    debug(message: string, ...args: any[]) {
        if (this.settings.debugMode) {
            // Use console.debug instead of console.log to follow guidelines
            // Debug messages should not show in default console configuration
            console.debug(`[OpenWebUI KB Sync] ${message}`, ...args);
        }
    }

    // Error logging - always logs critical errors, but shows more detail in debug mode
    logError(message: string, error?: any) {
        if (this.settings.debugMode) {
            console.error(`[OpenWebUI KB Sync] ${message}`, error);
        } else {
            console.error(`[OpenWebUI KB Sync] ${message}`);
        }
    }

    startAutoSync() {
        // Stop any existing timer first
        this.stopAutoSync();
        
        if (this.settings.autoSyncEnabled && this.settings.autoSyncInterval > 0) {
            // NEW: Mobile-aware interval calculation
            const baseInterval = this.settings.autoSyncInterval;
            const connectionType = getConnectionType();
            const isMobile = isMobileDevice();
            
            let multiplier = 1;
            if (isMobile || connectionType === 'cellular') {
                multiplier = this.settings.mobile.cellularAutoSyncMultiplier;
            }
            
            const intervalMs = baseInterval * multiplier * 60 * 1000;
            
            this.autoSyncTimer = window.setInterval(async () => {
                this.debug('Auto-sync triggered');
                
                // Check if manual sync is already running
                if (this.syncMutex) {
                    this.debug('Auto-sync skipped: manual sync in progress');
                    return;
                }
                
                // NEW: Mobile and battery-aware auto-sync
                if (await this.shouldSkipAutoSync()) {
                    return;
                }
                
                await this.syncToKnowledgeBase();
            }, intervalMs);
            
            this.debug(`Auto-sync started with ${baseInterval * multiplier} minute interval (mobile: ${isMobile}, connection: ${connectionType})`);
        }
    }

    stopAutoSync() {
        if (this.autoSyncTimer !== null) {
            window.clearInterval(this.autoSyncTimer);
            this.autoSyncTimer = null;
            this.debug('Auto-sync stopped');
        }
    }
    
    // NEW: Mobile and battery-aware sync checks
    async shouldSkipAutoSync(): Promise<boolean> {
        const isMobile = isMobileDevice();
        const settings = this.settings.mobile;
        
        // Check battery level if optimization enabled
        if (isMobile && settings.batteryOptimization) {
            const batteryLevel = await getBatteryLevel();
            if (batteryLevel < settings.lowBatteryThreshold) {
                this.debug(`Auto-sync skipped: low battery (${batteryLevel}% < ${settings.lowBatteryThreshold}%)`);
                return true;
            }
        }
        
        // Check if background sync is disabled and app might be backgrounded
        if (isMobile && !settings.enableBackgroundSync && document.hidden) {
            this.debug('Auto-sync skipped: app backgrounded and background sync disabled');
            return true;
        }
        
        return false;
    }
    
    // NEW: Network-aware sync permission check
    async shouldAllowSync(): Promise<{allow: boolean, reason?: string}> {
        const connectionType = getConnectionType();
        const settings = this.settings.mobile;
        
        // Always allow WiFi or unknown connections
        if (connectionType === 'wifi' || connectionType === 'unknown') {
            return {allow: true};
        }
        
        // Handle cellular based on user preference
        if (connectionType === 'cellular') {
            switch (settings.networkBehavior) {
                case 'always':
                    return {allow: true};
                    
                case 'wifi-preferred':
                    // Show warning occasionally but allow sync
                    if (this.shouldShowCellularWarning()) {
                        new Notice('Syncing over cellular data (change in mobile settings if needed)', 4000);
                        this.lastCellularWarning = Date.now();
                    }
                    return {allow: true};
                    
                case 'wifi-only':
                    return {allow: false, reason: 'WiFi-only mode enabled in mobile settings'};
                    
                default:
                    return {allow: true};
            }
        }
        
        return {allow: true};
    }
    
    // NEW: Throttle cellular warnings
    private shouldShowCellularWarning(): boolean {
        return Date.now() - this.lastCellularWarning > this.CELLULAR_WARNING_INTERVAL;
    }
    
    // NEW: Get mobile-optimized sync configuration
    getMobileAdjustedConfig(isCellular: boolean) {
        const settings = this.settings.mobile;
        
        return {
            maxFileSize: isCellular ? settings.cellularFileLimit : 5 * 1024 * 1024,
            batchSize: isCellular ? Math.min(settings.batchSize, 3) : settings.batchSize,
            maxConcurrent: isCellular ? 1 : settings.maxConcurrentUploads
        };
    }

    updateStatusBar() {
        // Clear any previous styling
        this.statusBarItem.removeClass('kb-status-ok', 'kb-status-error', 'kb-status-syncing');
        
        if (this.syncStatus.issyncing) {
            // Show progress during active sync
            this.statusBarItem.setText(`KB: ${this.syncStatus.synced}/${this.syncStatus.total}`);
            this.statusBarItem.addClass('kb-status-syncing');
            this.statusBarItem.title = 'OpenWebUI sync in progress...';
        } else if (this.syncStatus.error) {
            // Show error status
            this.statusBarItem.setText('KB: ✗');
            this.statusBarItem.addClass('kb-status-error');
            this.statusBarItem.title = 'OpenWebUI sync failed - check console for details';
        } else if (!this.settings.apiToken || !this.settings.openwebuiUrl) {
            // Not configured
            this.statusBarItem.setText('KB: ⚠');
            this.statusBarItem.addClass('kb-status-error');
            this.statusBarItem.title = 'OpenWebUI not configured - check plugin settings';
        } else {
            // All good
            this.statusBarItem.setText('KB: ✓');
            this.statusBarItem.addClass('kb-status-ok');
            this.statusBarItem.title = 'OpenWebUI sync ready';
        }
    }

    // ENHANCED: Main sync method with concurrency protection and network awareness
    async syncToKnowledgeBase() {
        // CRITICAL: Prevent concurrent syncs
        if (this.syncMutex) {
            this.debug('Sync already in progress, skipping concurrent request');
            new Notice('Sync already in progress, please wait...');
            return;
        }
        
        if (!this.settings.apiToken) {
            new Notice('Please configure OpenWebUI API token in settings');
            return;
        }
        
        // NEW: Check network permissions
        const syncPermission = await this.shouldAllowSync();
        if (!syncPermission.allow) {
            this.debug(`Sync blocked: ${syncPermission.reason}`);
            new Notice(`Sync blocked: ${syncPermission.reason}`);
            return;
        }

        // Acquire mutex lock
        this.syncMutex = true;
        this.debug('Sync mutex acquired');

        try {
            await this.performSyncOperation();
        } finally {
            // Always release mutex, even if sync fails
            this.syncMutex = false;
            this.debug('Sync mutex released');
        }
    }

    // NEW: The actual sync logic (separated for clean mutex handling)
    async performSyncOperation() {
        try {
            // Clean up deleted files first
            await this.cleanupDeletedFiles();
            
            // Find all files with #kb/ tags
            const filesToSync = await this.findFilesWithKBTags();
            
            // Group by file to handle multiple KBs per file
            const fileGroups = new Map<string, string[]>();
            for (const item of filesToSync) {
                const filePath = item.file.path;
                if (!fileGroups.has(filePath)) {
                    fileGroups.set(filePath, []);
                }
                fileGroups.get(filePath)!.push(item.knowledgeBase);
            }

            if (fileGroups.size === 0) {
                new Notice('No files found with #kb/ tags');
                return;
            }

            this.syncStatus = {
                synced: 0,
                total: filesToSync.length,
                issyncing: true,
                error: false
            };
            this.updateStatusBar();

            this.debug(`Found ${fileGroups.size} files to sync to ${filesToSync.length} knowledge bases`);

            // NEW: Mobile-aware batch processing
            const connectionType = getConnectionType();
            const isCellular = connectionType === 'cellular';
            const config = this.getMobileAdjustedConfig(isCellular);
            
            this.debug(`Using mobile config: batchSize=${config.batchSize}, maxConcurrent=${config.maxConcurrent}, maxFileSize=${config.maxFileSize}`);

            // Process files in batches
            const fileEntries = Array.from(fileGroups.entries());
            for (let i = 0; i < fileEntries.length; i += config.batchSize) {
                const batch = fileEntries.slice(i, i + config.batchSize);
                
                // Process batch with controlled concurrency
                if (config.maxConcurrent === 1) {
                    // Sequential processing for cellular
                    for (const [filePath, currentKBs] of batch) {
                        try {
                            const file = this.app.vault.getAbstractFileByPath(filePath);
                            if (file instanceof TFile) {
                                await this.syncFileWithStateTracking(file, currentKBs, config);
                            }
                        } catch (error) {
                            this.logError(`Failed to sync file ${filePath}`, error);
                            new Notice(`Failed to sync ${filePath}: ${error.message}`);
                        }
                    }
                } else {
                    // Parallel processing for WiFi
                    await Promise.all(batch.map(async ([filePath, currentKBs]) => {
                        try {
                            const file = this.app.vault.getAbstractFileByPath(filePath);
                            if (file instanceof TFile) {
                                await this.syncFileWithStateTracking(file, currentKBs, config);
                            }
                        } catch (error) {
                            this.logError(`Failed to sync file ${filePath}`, error);
                            new Notice(`Failed to sync ${filePath}: ${error.message}`);
                        }
                    }));
                }
                
                // Small delay between batches to prevent overwhelming the system
                if (i + config.batchSize < fileEntries.length) {
                    await new Promise(resolve => setTimeout(resolve, isCellular ? 500 : 100));
                }
            }

            // Handle files that no longer have KB tags
            await this.handleUntaggedFiles(fileGroups);

            
            this.syncStatus.issyncing = false;
            this.syncStatus.error = false; // Clear any previous error state
            this.updateStatusBar();
            new Notice(`Sync completed: ${this.syncStatus.synced}/${this.syncStatus.total} operations`);

        } catch (error) {
            this.logError('Sync failed', error);
            this.syncStatus.error = true;
            this.syncStatus.issyncing = false;
            this.updateStatusBar();
            new Notice(`Sync failed: ${error.message}`);
        }
    }

    // ENHANCED: File sync with improved state tracking and mobile awareness
    async syncFileWithStateTracking(file: TFile, currentKBs: string[], config?: {maxFileSize: number, batchSize: number, maxConcurrent: number}) {
        const filePath = normalizePath(file.path);
        
        // NEW: File modification time check for optimization
        const lastModified = file.stat.mtime || Date.now();
        const previousRecord = this.settings.fileMapping[filePath];
        
        // Quick check: if file hasn't been modified and we have a record, skip reading content
        const timeChanged = !previousRecord || previousRecord.lastModified !== lastModified;
        
        let content: string;
        let contentHash: string;
        
        if (timeChanged) {
            const rawContent = await this.app.vault.read(file);
            
            // NEW: File size check for mobile
            if (config && config.maxFileSize > 0 && rawContent.length > config.maxFileSize) {
                const sizeMB = (rawContent.length / (1024 * 1024)).toFixed(2);
                const limitMB = (config.maxFileSize / (1024 * 1024)).toFixed(2);
                throw new Error(`File too large (${sizeMB}MB > ${limitMB}MB limit on current connection)`);
            }
            
            // Process Obsidian links before uploading to OpenWebUI
            const vaultName = this.app.vault.getName();
            content = processObsidianLinks(rawContent, vaultName);
            contentHash = generateContentHash(content);
        } else {
            // Reuse previous hash if file hasn't changed
            contentHash = previousRecord.contentHash;
            content = ''; // Will not be used
        }
        
        // Get current state
        const previousKBs = this.settings.syncState[filePath] || [];
        
        this.debug(`Syncing ${filePath}:`);
        this.debug(`  Current KBs: [${currentKBs.join(', ')}]`);
        this.debug(`  Previous KBs: [${previousKBs.join(', ')}]`);
        this.debug(`  Content hash: ${contentHash.substring(0, 16)}...`);
        this.debug(`  Time changed: ${timeChanged}`);
        
        // Check if file content has changed
        const contentChanged = timeChanged && (!previousRecord || previousRecord.contentHash !== contentHash);
        const kbsChanged = JSON.stringify(currentKBs.sort()) !== JSON.stringify(previousKBs.sort());
        
        this.debug(`  Content changed: ${contentChanged}`);
        this.debug(`  KBs changed: ${kbsChanged}`);
        
        if (!contentChanged && !kbsChanged) {
            this.debug(`  No changes detected, skipping sync`);
            return; // No changes needed
        }
        
        // If content changed, we need to handle existing file
        if (contentChanged && previousRecord) {
            await this.removeFileFromAllKnowledgeBases(previousRecord);
        }
        
        // Calculate KB operations needed
        const kbsToRemoveFrom = previousKBs.filter(kb => !currentKBs.includes(kb));
        const kbsToAddTo = currentKBs.filter(kb => !previousKBs.includes(kb));
        const kbsToUpdate = contentChanged ? currentKBs.filter(kb => previousKBs.includes(kb)) : [];
        
        // Remove from old KBs (only if content hasn't changed)
        if (!contentChanged) {
            for (const kbName of kbsToRemoveFrom) {
                try {
                    await this.removeFileFromKnowledgeBase(kbName, previousRecord);
                    this.syncStatus.synced++;
                    this.updateStatusBar();
                } catch (error) {
                    this.logError(`Failed to remove from KB ${kbName}`, error);
                }
            }
        }
        
        // Upload new/updated file if needed
        let newRecord: OpenWebUIFileRecord | null = null;
        if (contentChanged || kbsToAddTo.length > 0 || kbsToUpdate.length > 0) {
            try {
                // Ensure we have content if we need to upload
                if (!content) {
                    const rawContent = await this.app.vault.read(file);
                    const vaultName = this.app.vault.getName();
                    content = processObsidianLinks(rawContent, vaultName);
                }
                
                const stableFilename = generateStableFilename(file.name, contentHash);
                this.debug(`  Uploading as: ${stableFilename}`);
                
                const uploadedFile = await this.uploadFile(stableFilename, content);
                
                newRecord = {
                    fileId: uploadedFile.id,
                    uploadedFilename: stableFilename,
                    contentHash: contentHash,
                    lastModified: lastModified,
                    knowledgeBases: []
                };
                
                this.debug(`  Uploaded file ID: ${newRecord.fileId}`);
                
            } catch (error) {
                this.logError(`Failed to upload file ${filePath}`, error);
                throw error;
            }
        } else {
            // Reuse existing record
            newRecord = previousRecord;
        }
        
        // Add to knowledge bases
        const targetKBs = contentChanged ? currentKBs : [...kbsToAddTo, ...kbsToUpdate];
        
        for (const kbName of targetKBs) {
            try {
                this.debug(`  Adding to KB: ${kbName}`);
                const kbId = await this.getOrCreateKnowledgeBase(kbName);
                await this.addFileToKnowledgeBase(kbId, newRecord.fileId);
                
                if (!newRecord.knowledgeBases.includes(kbName)) {
                    newRecord.knowledgeBases.push(kbName);
                }
                
                this.syncStatus.synced++;
                this.updateStatusBar();
            } catch (error) {
                this.logError(`Failed to add to KB ${kbName}`, error);
            }
        }
        
        // Update state
        this.settings.syncState[filePath] = [...currentKBs];
        this.settings.fileMapping[filePath] = newRecord;
        await this.saveSettings();
        
        this.debug(`  Successfully synced ${filePath}`);
    }

    // NEW: Remove file from all knowledge bases it's currently in
    async removeFileFromAllKnowledgeBases(record: OpenWebUIFileRecord) {
        this.debug(`Removing file ${record.uploadedFilename} from all knowledge bases`);
        
        let successfulRemovals = 0;
        let totalAttempts = record.knowledgeBases.length;
        
        for (const kbName of [...record.knowledgeBases]) { // Create copy to avoid mutation during iteration
            try {
                await this.removeFileFromKnowledgeBase(kbName, record);
                successfulRemovals++;
            } catch (error) {
                this.logError(`Failed to remove ${record.uploadedFilename} from KB ${kbName}`, error);
                // Continue with other KBs - don't let one failure stop the whole process
            }
        }
        
        this.debug(`Removed file from ${successfulRemovals}/${totalAttempts} knowledge bases`);
        
        // Try to delete the file itself from OpenWebUI
        try {
            await this.deleteFileFromOpenWebUI(record.fileId);
        } catch (error) {
            this.debug(`Could not delete file ${record.fileId} from OpenWebUI:`, error);
            // Not critical - file might be referenced elsewhere
        }
    }

    // ENHANCED: Remove file from knowledge base using file record
    async removeFileFromKnowledgeBase(kbName: string, record: OpenWebUIFileRecord) {
        try {
            const kbId = await this.findKnowledgeBaseByName(kbName);
            if (!kbId) {
                this.debug(`Knowledge base ${kbName} not found, skipping removal`);
                return;
            }
            
            this.debug(`Removing file ${record.fileId} from KB ${kbName} (${kbId})`);
            
            await this.makeApiRequest(`/api/v1/knowledge/${kbId}/file/remove`, {
                method: 'POST',
                body: { file_id: record.fileId }
            });
            
            this.debug(`Successfully removed file from KB ${kbName}`);
            
            // Update record
            record.knowledgeBases = record.knowledgeBases.filter(kb => kb !== kbName);
            
        } catch (error) {
            // Handle "not found" errors gracefully - file might already be removed
            if (error.message && (error.message.includes('could not find') || error.message.includes('404') || error.message.includes('400'))) {
                this.debug(`File ${record.fileId} not found in KB ${kbName} (already removed): ${error.message}`);
                // Update record anyway since file is clearly not in this KB
                record.knowledgeBases = record.knowledgeBases.filter(kb => kb !== kbName);
                return;
            }
            
            this.logError(`Failed to remove file from KB ${kbName}`, error);
            throw error;
        }
    }

    // NEW: Delete file completely from OpenWebUI
    async deleteFileFromOpenWebUI(fileId: string) {
        try {
            await this.makeApiRequest(`/api/v1/files/${fileId}`, {
                method: 'DELETE'
            });
            this.debug(`Successfully deleted file ${fileId} from OpenWebUI`);
        } catch (error) {
            // Handle "not found" errors gracefully - file might already be deleted
            if (error.message && (error.message.includes('could not find') || error.message.includes('404') || error.message.includes('400'))) {
                this.debug(`File ${fileId} not found in OpenWebUI (already deleted): ${error.message}`);
                return;
            }
            this.debug(`Could not delete file ${fileId}:`, error);
            // Not critical - file might be in use elsewhere
        }
    }

    // ENHANCED: Cleanup when files are deleted from Obsidian
    async cleanupDeletedFiles() {
        const currentFiles = new Set(this.app.vault.getMarkdownFiles().map(f => normalizePath(f.path)));
        const trackedFiles = Object.keys(this.settings.fileMapping);
        
        for (const filePath of trackedFiles) {
            const normalizedPath = normalizePath(filePath);
            if (!currentFiles.has(normalizedPath)) {
                this.debug(`Cleaning up deleted file: ${filePath}`);
                
                const record = this.settings.fileMapping[filePath];
                if (record) {
                    await this.removeFileFromAllKnowledgeBases(record);
                }
                
                // Remove from tracking
                delete this.settings.fileMapping[filePath];
                delete this.settings.syncState[filePath];
            }
        }
        
        await this.saveSettings();
    }

    // NEW: Handle files that no longer have KB tags
    async handleUntaggedFiles(currentlyTaggedFiles: Map<string, string[]>) {
        for (const [filePath, record] of Object.entries(this.settings.fileMapping)) {
            if (!currentlyTaggedFiles.has(filePath)) {
                // File no longer has KB tags, remove from all KBs
                this.debug(`File ${filePath} no longer has KB tags, removing from all KBs`);
                
                try {
                    await this.removeFileFromAllKnowledgeBases(record);
                    
                    // Remove from tracking
                    delete this.settings.fileMapping[filePath];
                    delete this.settings.syncState[filePath];
                    
                    this.syncStatus.synced++;
                    this.updateStatusBar();
                } catch (error) {
                    this.logError(`Failed to remove untagged file ${filePath}`, error);
                }
            }
        }
        
        await this.saveSettings();
    }

    // NEW: Cached knowledge base lookup
    async findKnowledgeBaseByName(name: string): Promise<string | null> {
        // Check cache first
        const cached = this.kbCache.get(name);
        if (cached && Date.now() - cached.timestamp < this.KB_CACHE_TTL) {
            this.debug(`KB cache hit for ${name}: ${cached.id}`);
            return cached.id;
        }
        
        try {
            const knowledgeBases = await this.makeApiRequest('/api/v1/knowledge/');
            if (knowledgeBases && Array.isArray(knowledgeBases)) {
                // Update cache for all knowledge bases
                for (const kb of knowledgeBases) {
                    this.kbCache.set(kb.name, {
                        id: kb.id,
                        timestamp: Date.now()
                    });
                }
                
                const existing = knowledgeBases.find((kb: KnowledgeBase) => kb.name === name);
                const result = existing ? existing.id : null;
                
                this.debug(`KB lookup for ${name}: ${result ? result : 'not found'} (cached ${knowledgeBases.length} entries)`);
                return result;
            }
        } catch (error) {
            this.logError(`Failed to find knowledge base ${name}`, error);
        }
        return null;
    }

    async findFilesWithKBTags(): Promise<{file: TFile, knowledgeBase: string}[]> {
        const files = this.app.vault.getMarkdownFiles();
        const results: {file: TFile, knowledgeBase: string}[] = [];

        for (const file of files) {
            const content = await this.app.vault.read(file);
            // Find ALL KB tags in the file, not just the first one
            const kbTagMatches = content.matchAll(/#kb\/([a-zA-Z0-9\-_]+)/g);
            
            for (const match of kbTagMatches) {
                const tagName = match[1];
                // Convert underscores and hyphens to spaces for knowledge base name
                const knowledgeBaseName = this.convertTagToKnowledgeBaseName(tagName);
                
                results.push({
                    file: file,
                    knowledgeBase: knowledgeBaseName
                });
            }
        }

        return results;
    }

    convertTagToKnowledgeBaseName(tagName: string): string {
        // Convert underscores and hyphens to spaces, then convert to title case
        // Example: "my-project" -> "My Project", "company_docs" -> "Company Docs"
        return tagName
            .replace(/[-_]/g, ' ')
            .toLowerCase()
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    convertKnowledgeBaseNameToTag(kbName: string): string {
        // Convert spaces to hyphens for display purposes
        // Example: "my project" -> "my-project"
        return kbName.replace(/\s+/g, '-').toLowerCase();
    }

    async makeApiRequest(endpoint: string, options: any = {}) {
        if (!this.settings.openwebuiUrl || !this.settings.apiToken) {
            throw new Error('OpenWebUI URL and API token must be configured');
        }

        const url = `${this.settings.openwebuiUrl.replace(/\/+$/, '')}${endpoint}`;
        
        const response = await requestUrl({
            url: url,
            method: options.method || 'GET',
            headers: {
                'Authorization': `Bearer ${this.settings.apiToken}`,
                'Content-Type': 'application/json',
                ...options.headers
            },
            body: options.body ? JSON.stringify(options.body) : undefined,
            throw: false
        });

        if (response.status === 404 && options.allowNotFound) {
            return null;
        }

        if (response.status >= 400) {
            throw new Error(`API request failed: ${response.status} ${response.text}`);
        }

        return response.json;
    }

    // NEW: Cached get-or-create knowledge base
    async getOrCreateKnowledgeBase(name: string): Promise<string> {
        // First try cached lookup
        const existingId = await this.findKnowledgeBaseByName(name);
        if (existingId) {
            this.debug(`Found existing knowledge base: ${name} (${existingId})`);
            return existingId;
        }

        // Create new knowledge base
        try {
            this.debug(`Creating new knowledge base: ${name}`);
            const newKb = await this.makeApiRequest('/api/v1/knowledge/create', {
                method: 'POST',
                body: {
                    name: name,
                    description: `Auto-created by Obsidian sync for ${name}`,
                    data: {},
                    access_control: {}
                }
            });
            
            // Cache the new knowledge base
            this.kbCache.set(name, {
                id: newKb.id,
                timestamp: Date.now()
            });
            
            this.debug(`Created knowledge base: ${name} (${newKb.id})`);
            return newKb.id;
        } catch (error) {
            this.logError(`Failed to create knowledge base ${name}`, error);
            throw error;
        }
    }

    // ENHANCED: Better error handling in upload
    async uploadFile(filename: string, content: string): Promise<UploadedFile> {
        try {
            const blob = new Blob([content], { type: 'text/markdown' });
            const formData = new FormData();
            formData.append('file', blob, filename);

            const response = await fetch(`${this.settings.openwebuiUrl.replace(/\/+$/, '')}/api/v1/files/`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.settings.apiToken}`,
                    'Accept': 'application/json'
                },
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                
                // Handle duplicate content error specifically
                if (response.status === 400 && errorText.includes('Duplicate content')) {
                    this.debug(`Duplicate content detected for ${filename}, this might be expected`);
                    throw new Error(`Duplicate content detected for ${filename}. The file content already exists in OpenWebUI.`);
                }
                
                throw new Error(`Upload failed: ${response.status} ${errorText}`);
            }

            const result = await response.json();
            this.debug(`Uploaded file: ${filename} (${result.id})`);
            return result;
        } catch (error) {
            this.logError(`Failed to upload file ${filename}`, error);
            throw error;
        }
    }

    async addFileToKnowledgeBase(kbId: string, fileId: string) {
        try {
            await this.makeApiRequest(`/api/v1/knowledge/${kbId}/file/add`, {
                method: 'POST',
                body: { file_id: fileId }
            });
            this.debug(`Added file ${fileId} to knowledge base ${kbId}`);
        } catch (error) {
            this.logError(`Failed to add file ${fileId} to knowledge base ${kbId}`, error);
            throw error;
        }
    }

    async testConnection(): Promise<boolean> {
        try {
            await this.makeApiRequest('/api/v1/knowledge/');
            // Clear error state on successful connection
            this.syncStatus.error = false;
            this.updateStatusBar();
            return true;
        } catch (error) {
            this.logError('Connection test failed', error);
            // Set error state on failed connection
            this.syncStatus.error = true;
            this.updateStatusBar();
            return false;
        }
    }

    // NEW: Check if sync is currently running
    isSyncInProgress(): boolean {
        return this.syncMutex;
    }

    // NEW: Force release mutex (emergency use only)
    forceReleaseSyncLock(): void {
        if (this.syncMutex) {
            this.debug('Force releasing sync mutex');
            this.syncMutex = false;
            this.syncStatus.issyncing = false;
            this.updateStatusBar();
        }
    }

}

class OpenWebUIKBSyncSettingTab extends PluginSettingTab {
    plugin: OpenWebUIKBSyncPlugin;

    constructor(app: App, plugin: OpenWebUIKBSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        // General settings section
        new Setting(containerEl)
            .setName('General settings')
            .setHeading();
        
        new Setting(containerEl)
            .setName('OpenWebUI URL')
            .setDesc('The base URL of your OpenWebUI instance (e.g., http://localhost:3000)')
            .addText(text => text
                .setPlaceholder('http://localhost:3000')
                .setValue(this.plugin.settings.openwebuiUrl)
                .onChange(async (value) => {
                    this.plugin.settings.openwebuiUrl = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('API token')
            .setDesc('Your OpenWebUI API token (Settings > Account in OpenWebUI)')
            .addText(text => text
                .setPlaceholder('Enter your API token')
                .setValue(this.plugin.settings.apiToken)
                .onChange(async (value) => {
                    this.plugin.settings.apiToken = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Test connection')
            .setDesc('Test the connection to your OpenWebUI instance')
            .addButton(button => button
                .setButtonText('Test')
                .onClick(async () => {
                    button.setButtonText('Testing...');
                    button.setDisabled(true);
                    
                    const isConnected = await this.plugin.testConnection();
                    
                    button.setButtonText(isConnected ? '✓ Success' : '✗ Failed');
                    
                    setTimeout(() => {
                        button.setButtonText('Test');
                        button.setDisabled(false);
                    }, 2000);
                    
                    if (isConnected) {
                        new Notice('Connection successful!');
                    } else {
                        new Notice('Connection failed. Check your settings.');
                    }
                }));

        // Auto-sync section with proper heading
        new Setting(containerEl)
            .setName('Auto-sync')
            .setHeading();

        new Setting(containerEl)
            .setName('Enable auto-sync')
            .setDesc('Automatically sync files at regular intervals')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoSyncEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.autoSyncEnabled = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.autoSyncEnabled) {
            new Setting(containerEl)
                .setName('Sync interval')
                .setDesc('How often to sync automatically (in minutes)')
                .addText(text => text
                    .setPlaceholder('5')
                    .setValue(this.plugin.settings.autoSyncInterval.toString())
                    .onChange(async (value) => {
                        const interval = parseInt(value);
                        if (!isNaN(interval) && interval > 0) {
                            this.plugin.settings.autoSyncInterval = interval;
                            await this.plugin.saveSettings();
                        }
                    }));
        }
        

        // Advanced section with proper heading
        new Setting(containerEl)
            .setName('Advanced')
            .setHeading();

        new Setting(containerEl)
            .setName('Debug mode')
            .setDesc('Enable detailed console logging for troubleshooting')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.debugMode)
                .onChange(async (value) => {
                    this.plugin.settings.debugMode = value;
                    await this.plugin.saveSettings();
                }));

        // NEW: Mobile settings section
        new Setting(containerEl)
            .setName('Mobile and network')
            .setHeading();

        new Setting(containerEl)
            .setName('Cellular sync behavior')
            .setDesc('How to handle sync when on cellular/mobile data')
            .addDropdown(dropdown => dropdown
                .addOption('always', 'Always sync (unlimited data)')
                .addOption('wifi-preferred', 'Sync with warning (limited data)')
                .addOption('wifi-only', 'WiFi only (strict data control)')
                .setValue(this.plugin.settings.mobile.networkBehavior)
                .onChange(async (value: 'always' | 'wifi-preferred' | 'wifi-only') => {
                    this.plugin.settings.mobile.networkBehavior = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Cellular file size limit')
            .setDesc('Maximum file size to sync over cellular in MB (0 = no limit)')
            .addText(text => text
                .setPlaceholder('1')
                .setValue((this.plugin.settings.mobile.cellularFileLimit / (1024 * 1024)).toString())
                .onChange(async (value) => {
                    const sizeMB = parseFloat(value) || 0;
                    this.plugin.settings.mobile.cellularFileLimit = sizeMB * 1024 * 1024;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Cellular auto-sync frequency')
            .setDesc('Auto-sync frequency multiplier on cellular (2x = half as often)')
            .addSlider(slider => slider
                .setLimits(1, 10, 1)
                .setValue(this.plugin.settings.mobile.cellularAutoSyncMultiplier)
                .onChange(async (value) => {
                    this.plugin.settings.mobile.cellularAutoSyncMultiplier = value;
                    await this.plugin.saveSettings();
                })
                .setDynamicTooltip());

        new Setting(containerEl)
            .setName('Battery optimization')
            .setDesc('Pause sync when battery is low (mobile devices only)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.mobile.batteryOptimization)
                .onChange(async (value) => {
                    this.plugin.settings.mobile.batteryOptimization = value;
                    await this.plugin.saveSettings();
                }));

        if (this.plugin.settings.mobile.batteryOptimization) {
            new Setting(containerEl)
                .setName('Low battery threshold')
                .setDesc('Pause sync when battery level drops below this percentage')
                .addSlider(slider => slider
                    .setLimits(5, 50, 5)
                    .setValue(this.plugin.settings.mobile.lowBatteryThreshold)
                    .onChange(async (value) => {
                        this.plugin.settings.mobile.lowBatteryThreshold = value;
                        await this.plugin.saveSettings();
                    })
                    .setDynamicTooltip());
        }

        new Setting(containerEl)
            .setName('Mobile batch size')
            .setDesc('Number of files to process simultaneously on mobile/cellular')
            .addSlider(slider => slider
                .setLimits(1, 10, 1)
                .setValue(this.plugin.settings.mobile.batchSize)
                .onChange(async (value) => {
                    this.plugin.settings.mobile.batchSize = value;
                    await this.plugin.saveSettings();
                })
                .setDynamicTooltip());

        // NEW: File Mapping Status Section
        this.displayFileMappingStatus(containerEl);

        // NEW: Sync Status Section
        this.displaySyncStatus(containerEl);

        // Usage Instructions
        new Setting(containerEl)
            .setName('Usage instructions')
            .setHeading();
        
        const instructions = containerEl.createDiv();
        
        // Basic usage section
        instructions.createEl('p', { text: 'To sync files to OpenWebUI Knowledge Base:' });
        const basicList = instructions.createEl('ol');
        
        const setupItem = basicList.createEl('li');
        setupItem.createSpan({ text: 'Configure your OpenWebUI URL and API token in ' });
        setupItem.createEl('strong', { text: 'General settings' });
        setupItem.createSpan({ text: ' above' });
        
        const firstItem = basicList.createEl('li');
        firstItem.createSpan({ text: 'Add one or more ' });
        firstItem.createEl('code', { text: '#kb/knowledge-base-name' });
        firstItem.createSpan({ text: ' tags to any markdown file' });
        
        basicList.createEl('li', { text: 'Click the sync button in the ribbon (or use auto-sync)' });
        basicList.createEl('li', { text: 'The plugin will automatically create knowledge bases if they don\'t exist' });
        basicList.createEl('li', { text: 'Files will be uploaded with content-based names to handle renames gracefully' });
        const smartSyncItem = basicList.createEl('li');
        smartSyncItem.createEl('strong', { text: 'Smart Sync: ' });
        smartSyncItem.createSpan({ text: 'If you remove KB tags, files will be automatically removed from those knowledge bases' });
        
        // Enhanced features section
        const enhancedTitle = instructions.createEl('p');
        enhancedTitle.createEl('strong', { text: 'Enhanced file handling:' });
        
        const featuresList = instructions.createEl('ul');
        
        const renameSafe = featuresList.createEl('li');
        renameSafe.createEl('strong', { text: 'Rename-safe: ' });
        renameSafe.createSpan({ text: 'Files can be renamed in Obsidian without breaking sync' });
        
        const contentBased = featuresList.createEl('li');
        contentBased.createEl('strong', { text: 'Content-based naming: ' });
        contentBased.createSpan({ text: 'Files are uploaded with stable names based on content hash' });
        
        const duplicateDetection = featuresList.createEl('li');
        duplicateDetection.createEl('strong', { text: 'Duplicate detection: ' });
        duplicateDetection.createSpan({ text: 'Prevents conflicts when content changes' });
        
        const autoCleanup = featuresList.createEl('li');
        autoCleanup.createEl('strong', { text: 'Automatic cleanup: ' });
        autoCleanup.createSpan({ text: 'Removes files when KB tags are removed' });
        
    }

    // NEW: Display current file mapping status
    displayFileMappingStatus(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('File mapping status')
            .setHeading();

        const statusContainer = containerEl.createEl('div');
        statusContainer.style.marginBottom = '20px';

        // Summary statistics
        const totalFiles = Object.keys(this.plugin.settings.fileMapping || {}).length;
        const totalSyncedFiles = Object.keys(this.plugin.settings.syncState || {}).length;

        const summaryDiv = statusContainer.createDiv();
        const trackingPara = summaryDiv.createEl('p');
        trackingPara.createEl('strong', { text: 'Tracking: ' });
        trackingPara.createSpan({ text: `${totalFiles} files with OpenWebUI mapping` });
        
        const syncedPara = summaryDiv.createEl('p');
        syncedPara.createEl('strong', { text: 'Synced: ' });
        syncedPara.createSpan({ text: `${totalSyncedFiles} files with active KB tags` });

        // Clear mapping button
        new Setting(statusContainer)
            .setName('Clear file mapping cache')
            .setDesc('Reset all file tracking data (files will remain in OpenWebUI)')
            .addButton(button => button
                .setButtonText('Clear cache')
                .setWarning()
                .onClick(async () => {
                    if (confirm('Are you sure? This will reset all file tracking data. Files will remain in OpenWebUI but may need to be manually cleaned up.')) {
                        this.plugin.settings.fileMapping = {};
                        this.plugin.settings.syncState = {};
                        await this.plugin.saveSettings();
                        this.display();
                        new Notice('File mapping cache cleared');
                    }
                }));

        // Force cleanup button
        new Setting(statusContainer)
            .setName('Force cleanup deleted files')
            .setDesc('Remove tracking for files that no longer exist in Obsidian')
            .addButton(button => button
                .setButtonText('Cleanup')
                .onClick(async () => {
                    button.setButtonText('Cleaning...');
                    button.setDisabled(true);
                    
                    try {
                        await this.plugin.cleanupDeletedFiles();
                        new Notice('Cleanup completed');
                        this.display(); // Refresh the display
                    } catch (error) {
                        new Notice(`Cleanup failed: ${error.message}`);
                    } finally {
                        button.setButtonText('Cleanup');
                        button.setDisabled(false);
                    }
                }));

        // Detailed file mapping display (if debug mode is enabled)
        if (this.plugin.settings.debugMode && totalFiles > 0) {
            const detailsContainer = statusContainer.createEl('details');
            const summary = detailsContainer.createEl('summary');
            summary.textContent = 'View file mapping details';
            summary.style.cursor = 'pointer';
            summary.style.fontWeight = 'bold';

            const mappingDiv = detailsContainer.createEl('div', { cls: 'kb-file-mapping-details' });

            let mappingText = '';
            for (const [filePath, record] of Object.entries(this.plugin.settings.fileMapping || {})) {
                mappingText += `📄 ${filePath}\n`;
                mappingText += `   OpenWebUI ID: ${record.fileId}\n`;
                mappingText += `   Filename: ${record.uploadedFilename}\n`;
                mappingText += `   Hash: ${record.contentHash.substring(0, 16)}...\n`;
                mappingText += `   KBs: [${record.knowledgeBases.join(', ')}]\n`;
                mappingText += `   Modified: ${new Date(record.lastModified).toLocaleString()}\n\n`;
            }

            mappingDiv.textContent = mappingText || 'No file mappings found.';
        }

        // Show current sync state in debug mode
        if (this.plugin.settings.debugMode && totalSyncedFiles > 0) {
            const syncStateContainer = statusContainer.createEl('details');
            const syncSummary = syncStateContainer.createEl('summary');
            syncSummary.textContent = 'View current sync state';
            syncSummary.style.cursor = 'pointer';
            syncSummary.style.fontWeight = 'bold';

            const syncDiv = syncStateContainer.createEl('div', { cls: 'kb-sync-state-details' });

            let syncText = '';
            for (const [filePath, kbs] of Object.entries(this.plugin.settings.syncState || {})) {
                syncText += `📋 ${filePath} → [${kbs.join(', ')}]\n`;
            }

            syncDiv.textContent = syncText || 'No sync state found.';
        }
    }

    // NEW: Display sync status and controls
    displaySyncStatus(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Sync status & controls')
            .setHeading();

        const statusContainer = containerEl.createEl('div');
        statusContainer.style.marginBottom = '20px';

        // Current sync status
        const statusDiv = statusContainer.createEl('div');
        const isRunning = this.plugin.isSyncInProgress();
        const statusText = isRunning ? 'Sync is currently running' : 'Sync is idle';
        
        const statusPara = statusDiv.createEl('p');
        statusPara.createEl('strong', { text: 'Status: ' });
        statusPara.createEl('span', { text: statusText, cls: 'kb-sync-status' });

        // Manual sync trigger
        new Setting(statusContainer)
            .setName('Manual sync')
            .setDesc('Trigger a sync operation manually')
            .addButton(button => button
                .setButtonText('Sync now')
                .setDisabled(isRunning)
                .onClick(async () => {
                    await this.plugin.syncToKnowledgeBase();
                    // Refresh the settings display after sync
                    setTimeout(() => this.display(), 1000);
                }));

        // Emergency controls (only show if debug mode is enabled)
        if (this.plugin.settings.debugMode) {
            new Setting(statusContainer)
                .setName('Emergency: force release lock')
                .setDesc('Use only if sync is stuck. This will force-release the sync lock.')
                .addButton(button => button
                    .setButtonText('Force release')
                    .setWarning()
                    .setDisabled(!isRunning)
                    .onClick(async () => {
                        if (confirm('Are you sure? This should only be used if sync appears to be stuck.')) {
                            this.plugin.forceReleaseSyncLock();
                            new Notice('Sync lock force-released');
                            this.display(); // Refresh display
                        }
                    }));
        }
    }
}