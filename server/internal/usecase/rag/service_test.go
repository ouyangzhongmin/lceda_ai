package rag

import (
	"strings"
	"testing"

	domainrag "lceda_ai/server/internal/domain/rag"
)

type spyAuditWriter struct {
	events []map[string]any
}

func (s *spyAuditWriter) Write(event map[string]any) error {
	s.events = append(s.events, event)
	return nil
}

type fixedVectorStore struct{}

func (f *fixedVectorStore) Search(_ domainrag.SearchQuery) ([]domainrag.SearchResult, error) {
	return []domainrag.SearchResult{
		{
			ChunkID:   "chk_test_001",
			Score:     0.99,
			Title:     "Test Citation",
			Snippet:   "snippet",
			SourceRef: "src#1",
			KBType:    "principle",
		},
	}, nil
}

type fixedVectorStoreWithCorpus struct {
	fixedVectorStore
	corpus []map[string]any
}

func (f *fixedVectorStoreWithCorpus) ExternalRagTemplateCorpus() any {
	return f.corpus
}

func TestBuildCitationPackageWritesAudit(t *testing.T) {
	writer := &spyAuditWriter{}
	service := NewService("test_collection", &fixedVectorStore{}, writer)

	pack, err := service.BuildCitationPackage("ldo", 3)
	if err != nil {
		t.Fatalf("BuildCitationPackage returned error: %v", err)
	}
	if pack.Query != "ldo" {
		t.Fatalf("unexpected query: %s", pack.Query)
	}
	if len(writer.events) != 1 {
		t.Fatalf("expected 1 audit event, got %d", len(writer.events))
	}

	if got := writer.events[0]["event_type"]; got != "rag_citation_package" {
		t.Fatalf("unexpected event_type: %v", got)
	}
}

func TestServiceExposesExternalRagTemplateCorpusWhenRetrieverSupportsIt(t *testing.T) {
	service := NewService(
		"test_collection",
		&fixedVectorStoreWithCorpus{
			corpus: []map[string]any{
				{
					"template_id": "external-rp2040-reset",
				},
			},
		},
	)

	corpus := service.ExternalRagTemplateCorpus("rp2040", 3)
	rows, ok := corpus.([]map[string]any)
	if !ok {
		t.Fatalf("expected []map[string]any corpus, got %T", corpus)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 corpus entry, got %d", len(rows))
	}
	if rows[0]["template_id"] != "external-rp2040-reset" {
		t.Fatalf("unexpected corpus payload: %+v", rows[0])
	}
}

type fixedVectorStoreWithEsp32DevboardHit struct{}

func (f *fixedVectorStoreWithEsp32DevboardHit) Search(_ domainrag.SearchQuery) ([]domainrag.SearchResult, error) {
	return []domainrag.SearchResult{
		{
			ChunkID:   "chk_esp32s3_001",
			Score:     0.97,
			Title:     "ESP32-S3 USB-C LDO Dev Board",
			Snippet:   "ESP32-S3 dev board with USB-C 5V input, LDO 3.3V regulator, 10uF bulk capacitor and 100nF decoupling capacitor.",
			SourceRef: "oshw-esp32s3-devboard#sheet1",
			KBType:    "open_source",
		},
	}, nil
}

func TestServiceBuildsHeuristicExternalCorpusFromSearchHits(t *testing.T) {
	service := NewService("test_collection", &fixedVectorStoreWithEsp32DevboardHit{})

	_, err := service.Search("esp32s3 开发板", 3)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}

	corpus := service.ExternalRagTemplateCorpus("esp32s3 开发板", 3)
	rows, ok := corpus.([]map[string]any)
	if !ok {
		t.Fatalf("expected []map[string]any corpus, got %T", corpus)
	}
	if len(rows) == 0 {
		t.Fatal("expected heuristic corpus entries, got none")
	}
	if rows[0]["anchor_device_model"] != "ESP32-S3" {
		t.Fatalf("unexpected anchor model: %v", rows[0]["anchor_device_model"])
	}
	if rows[0]["template_type"] != "mcu_power_core" {
		t.Fatalf("unexpected template type: %v", rows[0]["template_type"])
	}
	components, ok := rows[0]["components"].([]map[string]any)
	if !ok || len(components) < 2 {
		t.Fatalf("expected heuristic components, got %#v", rows[0]["components"])
	}
}

type fixedVectorStoreWithMultiBoardHits struct{}

func (f *fixedVectorStoreWithMultiBoardHits) Search(_ domainrag.SearchQuery) ([]domainrag.SearchResult, error) {
	return []domainrag.SearchResult{
		{
			ChunkID:   "chk_esp32c3_001",
			Score:     0.96,
			Title:     "ESP32-C3 Mini Board",
			Snippet:   "ESP32-C3 board includes LDO 3.3V power stage, 10uF capacitor and 100nF decoupling for the MCU.",
			SourceRef: "oshw-esp32c3#power",
			KBType:    "open_source",
		},
		{
			ChunkID:   "chk_rp2040_001",
			Score:     0.94,
			Title:     "RP2040 Dev Board",
			Snippet:   "RP2040 design with RUN reset button and status LED indicator on GPIO25.",
			SourceRef: "oshw-rp2040#control",
			KBType:    "open_source",
		},
		{
			ChunkID:   "chk_stm32_001",
			Score:     0.95,
			Title:     "STM32F103 Core Board",
			Snippet:   "STM32F103 board with NRST reset button, BOOT0 boot button and status LED indicator on PA5.",
			SourceRef: "oshw-stm32f103#control",
			KBType:    "open_source",
		},
	}, nil
}

func TestServiceBuildsHeuristicCorpusForEsp32c3Rp2040AndStm32f103ControlPatterns(t *testing.T) {
	service := NewService("test_collection", &fixedVectorStoreWithMultiBoardHits{})

	_, err := service.Search("开发板 外围", 5)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}

	corpus := service.ExternalRagTemplateCorpus("开发板 外围", 5)
	rows, ok := corpus.([]map[string]any)
	if !ok {
		t.Fatalf("expected []map[string]any corpus, got %T", corpus)
	}

	templateByID := map[string]map[string]any{}
	for _, row := range rows {
		templateByID[row["template_id"].(string)] = row
	}

	if templateByID["heuristic-esp32c3-mcu-power-core"] == nil {
		t.Fatalf("missing esp32c3 power core template: %#v", rows)
	}
	if templateByID["heuristic-rp2040-reset-button"] == nil {
		t.Fatalf("missing rp2040 reset template: %#v", rows)
	}
	if templateByID["heuristic-rp2040-status-indicator"] == nil {
		t.Fatalf("missing rp2040 status template: %#v", rows)
	}
	if templateByID["heuristic-stm32f103-reset-button"] == nil {
		t.Fatalf("missing stm32f103 reset template: %#v", rows)
	}
	if templateByID["heuristic-stm32f103-boot-button"] == nil {
		t.Fatalf("missing stm32f103 boot template: %#v", rows)
	}
	if templateByID["heuristic-stm32f103-status-indicator"] == nil {
		t.Fatalf("missing stm32f103 status template: %#v", rows)
	}

	if templateByID["heuristic-rp2040-status-indicator"]["template_type"] != "status_indicator" {
		t.Fatalf("unexpected rp2040 template type: %v", templateByID["heuristic-rp2040-status-indicator"]["template_type"])
	}
	if templateByID["heuristic-stm32f103-boot-button"]["anchor_device_model"] != "STM32F103" {
		t.Fatalf("unexpected stm32f103 boot anchor: %v", templateByID["heuristic-stm32f103-boot-button"]["anchor_device_model"])
	}
}

type fixedVectorStoreWithProjectComboAndTemplateHits struct{}

func (f *fixedVectorStoreWithProjectComboAndTemplateHits) Search(_ domainrag.SearchQuery) ([]domainrag.SearchResult, error) {
	return []domainrag.SearchResult{
		{
			ChunkID:   "tpl_1",
			Score:     0.97,
			Title:     "tpl-esp32-s3-gpio_passive_power_chain-80cf943d.md",
			Snippet:   "P1: EN -> R47 -> 3V3",
			SourceRef: "tpl-esp32-s3-gpio_passive_power_chain-80cf943d",
			KBType:    "template",
		},
		{
			ChunkID:   "combo_1",
			Score:     0.96,
			Title:     "project_combo_local-files-022.md",
			Snippet:   "project_combo_bundle\n连接链:\n- EN -> R47 -> 3V3\n- GPIO0 -> R46 -> 3V3",
			SourceRef: "project_combo_local-files-022",
			KBType:    "template",
		},
	}, nil
}

func TestServicePromotesProjectComboForCombinationQueries(t *testing.T) {
	service := NewService("test_collection", &fixedVectorStoreWithProjectComboAndTemplateHits{})

	results, err := service.Search("ESP32-S3 GPIO 电阻 电容 VCC", 5)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}
	if len(results) < 2 {
		t.Fatalf("expected at least 2 results, got %d", len(results))
	}
	if results[0].Title != "project_combo_local-files-022.md" {
		t.Fatalf("expected project combo first, got %q", results[0].Title)
	}
}

type captureTopKVectorStore struct {
	lastTopK int
}

func (f *captureTopKVectorStore) Search(query domainrag.SearchQuery) ([]domainrag.SearchResult, error) {
	f.lastTopK = query.TopK
	return []domainrag.SearchResult{
		{
			ChunkID:   "combo_1",
			Score:     0.90,
			Title:     "project_combo_local-files-190.md",
			Snippet:   "project_combo_bundle\n连接链:\n- EN -> R5 -> 3V3",
			SourceRef: "project_combo_local-files-190",
			KBType:    "template",
		},
		{
			ChunkID:   "tpl_1",
			Score:     0.95,
			Title:     "tpl-esp32-s3-mcu_boot_reset-9b4f7835.md",
			Snippet:   "ESP32-S3 mcu_boot_reset template",
			SourceRef: "tpl-esp32-s3-mcu_boot_reset-9b4f7835",
			KBType:    "template",
		},
	}, nil
}

func TestServiceExpandsRetrievalWindowBeforeRerank(t *testing.T) {
	store := &captureTopKVectorStore{}
	service := NewService("test_collection", store)

	results, err := service.Search("ESP32-S3 复位网络", 5)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}
	if store.lastTopK != 20 {
		t.Fatalf("expected expanded topK=20, got %d", store.lastTopK)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if results[0].Title != "project_combo_local-files-190.md" {
		t.Fatalf("expected project combo first after rerank, got %q", results[0].Title)
	}
}

type fixedVectorStoreWithResetNoiseHits struct{}

func (f *fixedVectorStoreWithResetNoiseHits) Search(_ domainrag.SearchQuery) ([]domainrag.SearchResult, error) {
	return []domainrag.SearchResult{
		{
			ChunkID:   "weak_1",
			Score:     0.99,
			Title:     "tpl-esp32-c3-mcu_boot_reset-d73ab677.md",
			Snippet:   "ESP32-C3 mcu_boot_reset template\nTemplate type: mcu_boot_reset",
			SourceRef: "tpl-esp32-c3-mcu_boot_reset-d73ab677",
			KBType:    "template",
		},
		{
			ChunkID:   "strong_1",
			Score:     0.94,
			Title:     "project_combo_local-files-086.md",
			Snippet:   "project_combo_bundle\n连接链:\n- BOOT -> R12 -> GND\n- EN -> R5 -> 3V3\n- EN -> R11 -> GND",
			SourceRef: "project_combo_local-files-086",
			KBType:    "template",
		},
		{
			ChunkID:   "mid_1",
			Score:     0.95,
			Title:     "tpl-esp32-s3-mcu_boot_reset-9b4f7835.md",
			Snippet:   "ESP32-S3 mcu_boot_reset template\nTemplate type: mcu_boot_reset",
			SourceRef: "tpl-esp32-s3-mcu_boot_reset-9b4f7835",
			KBType:    "template",
		},
	}, nil
}

func TestServicePromotesRealResetChainsOverWeakBootResetTemplates(t *testing.T) {
	service := NewService("test_collection", &fixedVectorStoreWithResetNoiseHits{})

	results, err := service.Search("ESP32-S3 复位网络", 5)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}
	if len(results) < 3 {
		t.Fatalf("expected at least 3 results, got %d", len(results))
	}
	if results[0].Title != "project_combo_local-files-086.md" {
		t.Fatalf("expected real project combo first, got %q", results[0].Title)
	}
	if results[len(results)-1].Title != "tpl-esp32-c3-mcu_boot_reset-d73ab677.md" {
		t.Fatalf("expected weak esp32-c3 boot reset last, got %q", results[len(results)-1].Title)
	}
}

type fixedVectorStoreWithEsp32S3ControlHits struct{}

func (f *fixedVectorStoreWithEsp32S3ControlHits) Search(_ domainrag.SearchQuery) ([]domainrag.SearchResult, error) {
	return []domainrag.SearchResult{
		{
			ChunkID:   "chk_esp32s3_uart_001",
			Score:     0.95,
			Title:     "ESP32-S3 Download Header",
			Snippet:   "ESP32-S3 board exposes a UART download header for TX RX EN IO0 GND and 3V3.",
			SourceRef: "oshw-esp32s3#uart",
			KBType:    "open_source",
		},
		{
			ChunkID:   "chk_esp32s3_power_led_001",
			Score:     0.93,
			Title:     "ESP32-S3 Power LED",
			Snippet:   "Power indicator LED on 3V3 rail with 1k resistor for ESP32-S3 board.",
			SourceRef: "oshw-esp32s3#power-led",
			KBType:    "open_source",
		},
		{
			ChunkID:   "chk_esp32s3_boot_reset_001",
			Score:     0.94,
			Title:     "ESP32-S3 EN IO0 Auto Download",
			Snippet:   "ESP32-S3 uses EN pull-up 10k, EN RC capacitor 1uF and IO0 boot button for download mode.",
			SourceRef: "oshw-esp32s3#boot-reset",
			KBType:    "open_source",
		},
	}, nil
}

func TestServiceBuildsHeuristicCorpusForEsp32s3UartPowerIndicatorAndBootReset(t *testing.T) {
	service := NewService("test_collection", &fixedVectorStoreWithEsp32S3ControlHits{})

	_, err := service.Search("esp32s3 下载 电源 指示", 5)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}

	corpus := service.ExternalRagTemplateCorpus("esp32s3 下载 电源 指示", 5)
	rows, ok := corpus.([]map[string]any)
	if !ok {
		t.Fatalf("expected []map[string]any corpus, got %T", corpus)
	}

	templateByID := map[string]map[string]any{}
	for _, row := range rows {
		templateByID[row["template_id"].(string)] = row
	}

	if templateByID["heuristic-esp32s3-uart-download-header"] == nil {
		t.Fatalf("missing esp32s3 uart template: %#v", rows)
	}
	if templateByID["heuristic-esp32s3-power-indicator"] == nil {
		t.Fatalf("missing esp32s3 power indicator template: %#v", rows)
	}
	if templateByID["heuristic-esp32s3-boot-reset"] == nil {
		t.Fatalf("missing esp32s3 boot/reset template: %#v", rows)
	}
	if templateByID["heuristic-esp32s3-boot-reset"]["template_type"] != "mcu_boot_reset" {
		t.Fatalf("unexpected boot/reset type: %v", templateByID["heuristic-esp32s3-boot-reset"]["template_type"])
	}
}

type fixedVectorStoreWithUsbCInputHit struct{}

func (f *fixedVectorStoreWithUsbCInputHit) Search(_ domainrag.SearchQuery) ([]domainrag.SearchResult, error) {
	return []domainrag.SearchResult{
		{
			ChunkID:   "chk_usb_c_001",
			Score:     0.96,
			Title:     "ESP32-S3 USB-C 5V Input",
			Snippet:   "USB-C 5V input with CC1 and CC2 5.1k resistors, VBUS fuse and ESD protection for ESP32-S3 dev board.",
			SourceRef: "oshw-esp32s3#usb-input",
			KBType:    "open_source",
		},
	}, nil
}

func TestServiceBuildsHeuristicCorpusForUsbC5VInputProtectionPattern(t *testing.T) {
	service := NewService("test_collection", &fixedVectorStoreWithUsbCInputHit{})

	_, err := service.Search("usb-c 5v 输入", 3)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}

	corpus := service.ExternalRagTemplateCorpus("usb-c 5v 输入", 3)
	rows, ok := corpus.([]map[string]any)
	if !ok {
		t.Fatalf("expected []map[string]any corpus, got %T", corpus)
	}

	var usbTemplate map[string]any
	for _, row := range rows {
		if row["template_id"] == "heuristic-esp32s3-usb-5v-input" {
			usbTemplate = row
			break
		}
	}
	if usbTemplate == nil {
		t.Fatalf("missing usb-c input template: %#v", rows)
	}
	if usbTemplate["template_type"] != "usb_power_input" {
		t.Fatalf("unexpected usb template type: %v", usbTemplate["template_type"])
	}
	components, ok := usbTemplate["components"].([]map[string]any)
	if !ok || len(components) < 4 {
		t.Fatalf("expected usb protection components, got %#v", usbTemplate["components"])
	}
}

type fixedVectorStoreWithPeripheralSubsystemHits struct{}

func (f *fixedVectorStoreWithPeripheralSubsystemHits) Search(_ domainrag.SearchQuery) ([]domainrag.SearchResult, error) {
	return []domainrag.SearchResult{
		{
			ChunkID:   "chk_i2c_sensor_001",
			Score:     0.94,
			Title:     "I2C Sensor Header",
			Snippet:   "I2C sensor module with SDA and SCL 4.7k pull-up resistors, 3V3 decoupling capacitor and 1x4 header.",
			SourceRef: "oshw-sensor#i2c",
			KBType:    "open_source",
		},
		{
			ChunkID:   "chk_mic_frontend_001",
			Score:     0.93,
			Title:     "MEMS Microphone Front End",
			Snippet:   "MEMS microphone front-end with 3V3 bypass capacitor, bias resistor and I2S interface header for audio capture.",
			SourceRef: "oshw-audio#mic",
			KBType:    "open_source",
		},
	}, nil
}

func TestServiceBuildsHeuristicCorpusForI2CSensorAndMicSubsystemPatterns(t *testing.T) {
	service := NewService("test_collection", &fixedVectorStoreWithPeripheralSubsystemHits{})

	_, err := service.Search("传感器 麦克风 小系统", 5)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}

	corpus := service.ExternalRagTemplateCorpus("传感器 麦克风 小系统", 5)
	rows, ok := corpus.([]map[string]any)
	if !ok {
		t.Fatalf("expected []map[string]any corpus, got %T", corpus)
	}

	templateByID := map[string]map[string]any{}
	for _, row := range rows {
		templateByID[row["template_id"].(string)] = row
	}

	if templateByID["heuristic-i2c-sensor-subsystem"] == nil {
		t.Fatalf("missing i2c sensor subsystem template: %#v", rows)
	}
	if templateByID["heuristic-mems-mic-subsystem"] == nil {
		t.Fatalf("missing mems mic subsystem template: %#v", rows)
	}
	if templateByID["heuristic-i2c-sensor-subsystem"]["template_type"] != "expansion_header" {
		t.Fatalf("unexpected i2c subsystem type: %v", templateByID["heuristic-i2c-sensor-subsystem"]["template_type"])
	}
	if templateByID["heuristic-mems-mic-subsystem"]["template_type"] != "expansion_header" {
		t.Fatalf("unexpected mic subsystem type: %v", templateByID["heuristic-mems-mic-subsystem"]["template_type"])
	}
}

type fixedVectorStoreWithGenericResetHits struct{}

func (f *fixedVectorStoreWithGenericResetHits) Search(_ domainrag.SearchQuery) ([]domainrag.SearchResult, error) {
	return []domainrag.SearchResult{
		{
			ChunkID:   "generic_reset_combo",
			Score:     0.97,
			Title:     "project_combo_local-files-027.md",
			Snippet:   "project_combo_bundle\nStatic quality score: 0.80\nIntent tags: gpio_bias\nScore reasons: real_connection_chains\n连接链:\n- EN -> R4 -> 3V3\n- GPIO0 -> R6 -> 3V3",
			SourceRef: "project_combo_local-files-027",
			KBType:    "template",
		},
	}, nil
}

func TestServiceSearchInjectsI2CPullupHeuristicWhenRecallLacksSdaSclHits(t *testing.T) {
	service := NewService("test_collection", &fixedVectorStoreWithGenericResetHits{})

	results, err := service.Search("I2C 上拉电阻", 5)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}
	if len(results) == 0 {
		t.Fatal("expected search results")
	}
	if results[0].SourceRef != "heuristic-i2c-sensor-subsystem" {
		t.Fatalf("expected injected I2C heuristic first, got %+v", results[0])
	}
	text := strings.ToUpper(results[0].Snippet)
	if !strings.Contains(text, "SDA") || !strings.Contains(text, "SCL") {
		t.Fatalf("expected heuristic result to include SDA/SCL evidence, got %+v", results[0])
	}
}

type fixedVectorStoreWithProjectComboHits struct{}

func (f *fixedVectorStoreWithProjectComboHits) Search(_ domainrag.SearchQuery) ([]domainrag.SearchResult, error) {
	return []domainrag.SearchResult{
		{
			ChunkID:   "chk_tpl_001",
			Score:     0.99,
			Title:     "ESP32C3 mcu_power_core template",
			Snippet:   "single template result",
			SourceRef: "tpl-esp32c3-mcu_power_core-b5e66d64",
			KBType:    "template",
		},
		{
			ChunkID:   "chk_combo_001",
			Score:     0.95,
			Title:     "EPro2 Verify project_combo_bundle",
			Snippet:   "Component bundle and Connection chains for project_combo_bundle",
			SourceRef: "project_combo_local-epro2-verify-1",
			KBType:    "template",
		},
		{
			ChunkID:   "chk_tpl_002",
			Score:     0.94,
			Title:     "ESP32C3 gpio_passive_power_chain template",
			Snippet:   "single template result",
			SourceRef: "tpl-esp32c3-gpio_passive_power_chain-ae8c63e9",
			KBType:    "template",
		},
	}, nil
}

func TestSearchReranksProjectComboBundleAheadOfSingleTemplates(t *testing.T) {
	service := NewService("test_collection", &fixedVectorStoreWithProjectComboHits{})

	results, err := service.Search("esp32c3 电源 组合", 5)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}
	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}
	if results[0].SourceRef != "project_combo_local-epro2-verify-1" {
		t.Fatalf("expected project combo bundle first, got %+v", results[0])
	}
	if results[1].SourceRef != "tpl-esp32c3-mcu_power_core-b5e66d64" {
		t.Fatalf("expected original highest-score single template second, got %+v", results[1])
	}
}

type fixedVectorStoreWithoutProjectComboHits struct{}

func (f *fixedVectorStoreWithoutProjectComboHits) Search(_ domainrag.SearchQuery) ([]domainrag.SearchResult, error) {
	return []domainrag.SearchResult{
		{
			ChunkID:   "chk_a",
			Score:     0.99,
			Title:     "A template",
			Snippet:   "first",
			SourceRef: "tpl-a",
			KBType:    "template",
		},
		{
			ChunkID:   "chk_b",
			Score:     0.97,
			Title:     "B template",
			Snippet:   "second",
			SourceRef: "tpl-b",
			KBType:    "template",
		},
	}, nil
}

func TestSearchKeepsOriginalOrderWhenNoProjectComboBundleExists(t *testing.T) {
	service := NewService("test_collection", &fixedVectorStoreWithoutProjectComboHits{})

	results, err := service.Search("普通模板", 5)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if results[0].SourceRef != "tpl-a" || results[1].SourceRef != "tpl-b" {
		t.Fatalf("expected original ordering to be preserved, got %+v", results)
	}
}

func TestRerankGroupedTemplateResultsUsesUnifiedScoreToPromoteRealResetChains(t *testing.T) {
	results := []domainrag.SearchResult{
		{
			ChunkID:   "weak_reset",
			Score:     0.99,
			Title:     "tpl-esp32-s3-mcu_boot_reset-weak.md",
			Snippet:   "Template type: mcu_boot_reset\nStatic quality score: 0.18\nIntent tags: reset\nScore reasons: token_fallback_chain",
			SourceRef: "tpl-esp32-s3-mcu_boot_reset-weak",
			KBType:    "template",
		},
		{
			ChunkID:   "real_combo",
			Score:     0.93,
			Title:     "project_combo_local-files-022.md",
			Snippet:   "project_combo_bundle\nStatic quality score: 0.91\nIntent tags: reset, gpio_bias\nScore reasons: real_connection_chains, project_combo_bundle\n连接链:\n- EN -> R47 -> 3V3\n- GPIO0 -> R46 -> 3V3",
			SourceRef: "project_combo_local-files-022",
			KBType:    "template",
		},
		{
			ChunkID:   "real_chain",
			Score:     0.95,
			Title:     "tpl-esp32-s3-gpio_passive_power_chain.md",
			Snippet:   "Static quality score: 0.84\nIntent tags: reset, gpio_bias\nScore reasons: real_connection_chains\nP1: EN -> R47 -> 3V3",
			SourceRef: "tpl-esp32-s3-gpio_passive_power_chain",
			KBType:    "template",
		},
	}

	reranked := rerankGroupedTemplateResults("ESP32-S3 复位 网络", results)
	if len(reranked) != 3 {
		t.Fatalf("expected 3 results, got %d", len(reranked))
	}
	if reranked[0].SourceRef != "project_combo_local-files-022" {
		t.Fatalf("expected real reset combo first, got %+v", reranked[0])
	}
	if reranked[2].SourceRef != "tpl-esp32-s3-mcu_boot_reset-weak" {
		t.Fatalf("expected weak boot/reset template last, got %+v", reranked[2])
	}
}

func TestRerankGroupedTemplateResultsPrefersPreciseResetChainOverBroadResetCombo(t *testing.T) {
	results := []domainrag.SearchResult{
		{
			ChunkID:   "broad_reset_combo",
			Score:     0.96,
			Title:     "project_combo_local-files-155.md",
			Snippet:   "project_combo_bundle\nStatic quality score: 0.92\nIntent tags: gpio_bias, reset, power\nScore reasons: real_connection_chains, token_fallback_chain\n连接链:\n- BOOT -> 10K -> VCC\n- RESET -> 100NF -> VCC\n- RST -> 10K -> VCC",
			SourceRef: "project_combo_local-files-155",
			KBType:    "template",
		},
		{
			ChunkID:   "precise_reset_chain",
			Score:     0.95,
			Title:     "tpl-esp32-s3-gpio_passive_power_chain-reset.md",
			Snippet:   "Static quality score: 0.98\nIntent tags: gpio_bias, reset, power\nScore reasons: real_connection_chains, lcsc_searchable_components\nP1: RESET -> R1 -> 3V3\nP1: RESET -> R13 -> GND\nP1: RESET -> R14 -> GND",
			SourceRef: "tpl-esp32-s3-gpio_passive_power_chain-reset",
			KBType:    "template",
		},
	}

	reranked := rerankGroupedTemplateResults("ESP32-S3 复位网络", results)
	if len(reranked) != 2 {
		t.Fatalf("expected 2 results, got %d", len(reranked))
	}
	if reranked[0].SourceRef != "tpl-esp32-s3-gpio_passive_power_chain-reset" {
		t.Fatalf("expected precise reset chain first, got %+v", reranked[0])
	}
}

func TestRerankGroupedTemplateResultsPrefersPreciseResetChainOverLiveLikeProjectCombo(t *testing.T) {
	results := []domainrag.SearchResult{
		{
			ChunkID:   "live_like_combo",
			Score:     0.6412350535392761,
			Title:     "project_combo_local-files-155.md",
			Snippet:   "# EDA-Camera照相机 project_combo_bundle\n项目: EDA-Camera照相机\n项目地址: local-files-155\n组合类型: reset_pullup_network\n电路功能: 复位上拉网络\n锚点信号: BOOT, RESET, RST\n配套器件: 100NF, 10K\nStatic quality score: 0.92\nIntent tags: gpio_bias, reset, power\nScore reasons: real_connection_chains, token_fallback_chain, lcsc_searchable_components, multi_component_context, source_project_traceable, anchor_model_detected\n连接链:\n- BOOT -> 10K -> VCC\n- RESET -> 100NF -> VCC\n- RST -> 10K -> VCC",
			SourceRef: "project_combo_local-files-155",
			KBType:    "template",
		},
		{
			ChunkID:   "live_like_chain",
			Score:     0.6488710641860962,
			Title:     "tpl-esp32-s3-gpio_passive_power_chain-80cf943d.md",
			Snippet:   "# ESP32-S3 gpio_passive_power_chain template\nESP32-S3 gpio_passive_power_chain template\nTemplate type: gpio_passive_power_chain\nScenario tags: gpio, passive-network, power-bias\nStatic quality score: 0.98\nIntent tags: gpio_bias, reset, power\nScore reasons: real_connection_chains, lcsc_searchable_components, multi_component_context, source_project_traceable, anchor_model_detected\n连接链:\n- P1: RESET -> R1 -> GND\n- P1: RESET -> R2 -> GND\n- P1: RESET -> R5 -> GND\n- P1: RESET -> R6 -> GND\n- P1: RESET -> R7 -> GND\n- P1: RESET -> R8 -> GND\n- P1: RESET -> R11 -> GND\n- P1: RESET -> R19 -> GND",
			SourceRef: "tpl-esp32-s3-gpio_passive_power_chain-80cf943d",
			KBType:    "template",
		},
	}

	reranked := rerankGroupedTemplateResults("ESP32-S3 复位网络", results)
	if len(reranked) != 2 {
		t.Fatalf("expected 2 results, got %d", len(reranked))
	}
	if reranked[0].SourceRef != "tpl-esp32-s3-gpio_passive_power_chain-80cf943d" {
		t.Fatalf("expected live-like precise reset chain first, got %+v", reranked[0])
	}
}

func TestRerankGroupedTemplateResultsLetsPreciseGPIOChainBeatBroadComboWhenIntentMatches(t *testing.T) {
	results := []domainrag.SearchResult{
		{
			ChunkID:   "broad_combo",
			Score:     0.97,
			Title:     "project_combo_local-files-031.md",
			Snippet:   "project_combo_bundle\nStatic quality score: 0.88\nIntent tags: reset, power\nScore reasons: real_connection_chains, project_combo_bundle\n连接链:\n- EN -> R5 -> 3V3\n- BOOT -> R6 -> GND",
			SourceRef: "project_combo_local-files-031",
			KBType:    "template",
		},
		{
			ChunkID:   "gpio_chain",
			Score:     0.94,
			Title:     "tpl-esp32-s3-gpio_passive_power_chain-io0.md",
			Snippet:   "Static quality score: 0.82\nIntent tags: gpio_bias\nScore reasons: real_connection_chains\nP1: GPIO0 -> R12 -> 3V3\nP1: GPIO0 boot strap pull-up 10k",
			SourceRef: "tpl-esp32-s3-gpio_passive_power_chain-io0",
			KBType:    "template",
		},
	}

	reranked := rerankGroupedTemplateResults("ESP32-S3 GPIO0 上拉 电阻", results)
	if len(reranked) != 2 {
		t.Fatalf("expected 2 results, got %d", len(reranked))
	}
	if reranked[0].SourceRef != "tpl-esp32-s3-gpio_passive_power_chain-io0" {
		t.Fatalf("expected precise gpio chain first, got %+v", reranked[0])
	}
}

func TestRerankGroupedTemplateResultsPreservesCompatibilityWithoutStaticScoringText(t *testing.T) {
	results := []domainrag.SearchResult{
		{
			ChunkID:   "legacy_reset",
			Score:     0.96,
			Title:     "tpl-esp32-s3-mcu_boot_reset-legacy.md",
			Snippet:   "ESP32-S3 mcu_boot_reset template\nTemplate type: mcu_boot_reset",
			SourceRef: "tpl-esp32-s3-mcu_boot_reset-legacy",
			KBType:    "template",
		},
		{
			ChunkID:   "legacy_combo",
			Score:     0.94,
			Title:     "project_combo_local-files-190.md",
			Snippet:   "project_combo_bundle\n连接链:\n- EN -> R5 -> 3V3\n- GPIO0 -> R2 -> 3V3",
			SourceRef: "project_combo_local-files-190",
			KBType:    "template",
		},
	}

	reranked := rerankGroupedTemplateResults("ESP32-S3 复位 EN", results)
	if len(reranked) != 2 {
		t.Fatalf("expected 2 results, got %d", len(reranked))
	}
	if reranked[0].SourceRef != "project_combo_local-files-190" {
		t.Fatalf("expected legacy combo with real chain evidence first, got %+v", reranked[0])
	}
}

func TestBuildIntentProfileDoesNotTreatPlainENAsResetIntent(t *testing.T) {
	profile := buildIntentProfile("ESP32-S3 EN 接法")
	if profile.wantsReset {
		t.Fatalf("expected plain EN query not to imply reset intent: %+v", profile)
	}
}

func TestBuildIntentProfileDoesNotTriggerComboForOrdinaryPowerPassivesQuery(t *testing.T) {
	profile := buildIntentProfile("ESP32-S3 3V3 电阻 电容 电源")
	if profile.wantsCombo {
		t.Fatalf("expected routine power/passive query not to imply combo intent: %+v", profile)
	}
}

func TestRerankGroupedTemplateResultsDoesNotOverPromoteComboForOrdinaryPowerPassivesQuery(t *testing.T) {
	results := []domainrag.SearchResult{
		{
			ChunkID:   "power_combo",
			Score:     0.96,
			Title:     "project_combo_local-files-088.md",
			Snippet:   "project_combo_bundle\nStatic quality score: 0.89\nIntent tags: power\n连接链:\n- VIN -> C1 -> GND\n- 3V3 -> C2 -> GND",
			SourceRef: "project_combo_local-files-088",
			KBType:    "template",
		},
		{
			ChunkID:   "precise_power",
			Score:     0.95,
			Title:     "tpl-esp32-s3-mcu_power_core.md",
			Snippet:   "Static quality score: 0.86\nIntent tags: power\n3V3 rail uses 10uF bulk capacitor and 100nF decoupling capacitor close to ESP32-S3.",
			SourceRef: "tpl-esp32-s3-mcu_power_core",
			KBType:    "template",
		},
	}

	reranked := rerankGroupedTemplateResults("ESP32-S3 3V3 电阻 电容 电源", results)
	if reranked[0].SourceRef != "tpl-esp32-s3-mcu_power_core" {
		t.Fatalf("expected precise power template first when combo intent is absent, got %+v", reranked[0])
	}
}

func TestRerankGroupedTemplateResultsPrefersI2CPullupChainsForI2CQuery(t *testing.T) {
	results := []domainrag.SearchResult{
		{
			ChunkID:   "generic_reset_combo",
			Score:     0.97,
			Title:     "project_combo_local-files-027.md",
			Snippet:   "project_combo_bundle\nStatic quality score: 0.80\nIntent tags: gpio_bias\nScore reasons: real_connection_chains\n连接链:\n- EN -> R4 -> 3V3\n- GPIO0 -> R6 -> 3V3",
			SourceRef: "project_combo_local-files-027",
			KBType:    "template",
		},
		{
			ChunkID:   "i2c_pullup_chain",
			Score:     0.95,
			Title:     "tpl-sensor-i2c-pullup.md",
			Snippet:   "Static quality score: 0.83\nIntent tags: gpio_bias, power\nScore reasons: real_connection_chains\nP1: SDA -> 4.7K -> 3V3\nP1: SCL -> 4.7K -> 3V3\nI2C sensor pull-up network",
			SourceRef: "tpl-sensor-i2c-pullup",
			KBType:    "template",
		},
	}

	reranked := rerankGroupedTemplateResults("I2C 上拉电阻", results)
	if reranked[0].SourceRef != "tpl-sensor-i2c-pullup" {
		t.Fatalf("expected I2C pull-up chain first, got %+v", reranked[0])
	}
}

func TestExtractionHelpersTolerateMinorFormattingVariation(t *testing.T) {
	result := domainrag.SearchResult{
		ChunkID:   "fmt_1",
		Score:     0.90,
		Title:     "fmt",
		Snippet:   "Static quality score ： 0.87\nIntent tags : reset; gpio_bias，power",
		SourceRef: "fmt",
		KBType:    "template",
	}

	score, ok := extractNamedFloat(result, "STATIC QUALITY SCORE")
	if !ok {
		t.Fatal("expected static quality score to parse with full-width colon")
	}
	if score != 0.87 {
		t.Fatalf("expected parsed score 0.87, got %v", score)
	}

	tags := extractIntentTags(result)
	if len(tags) != 3 {
		t.Fatalf("expected 3 intent tags, got %#v", tags)
	}
	if tags[0] != "RESET" || tags[1] != "GPIO_BIAS" || tags[2] != "POWER" {
		t.Fatalf("unexpected tags: %#v", tags)
	}
}

func TestRerankGroupedTemplateResultsPrefersOfficialCurrentSenseKnowledgeForCurrentSenseQuery(t *testing.T) {
	results := []domainrag.SearchResult{
		{
			ChunkID:   "temp_sense",
			Score:     0.6012,
			Title:     "tpl-esp32c3-temperature_sense-61d7eb8b.md",
			Snippet:   "temperature sense template\nStatic quality score: 0.82\nNTC divider and ADC sampling for temperature sense.",
			SourceRef: "tpl-esp32c3-temperature_sense-61d7eb8b",
			KBType:    "template",
		},
		{
			ChunkID:   "current_sense_doc",
			Score:     0.6189,
			Title:     "www.onsemi.com-current-sense-design-tool-360cb8d39b.md",
			Snippet:   "Current Sense Design Tool\nDesign your Current Sense Solution with ease\nshunt-based current sense solution\nGain error\nOffset voltage and drift",
			SourceRef: "www.onsemi.com-current-sense-design-tool-360cb8d39b",
			KBType:    "principle",
		},
	}

	reranked := rerankGroupedTemplateResults("current sense", results)
	if reranked[0].SourceRef != "www.onsemi.com-current-sense-design-tool-360cb8d39b" {
		t.Fatalf("expected official current sense knowledge first, got %+v", reranked[0])
	}
}

func TestRerankGroupedTemplateResultsPrefersOfficialEmiKnowledgeForEmiQuery(t *testing.T) {
	results := []domainrag.SearchResult{
		{
			ChunkID:   "emi_doc",
			Score:     0.6828,
			Title:     "www.ti.com-snva489c-pdf-c53bd72bcd.md",
			Snippet:   "Application Report\nSimple Success With Conducted EMI From DC-DC Converters\nEMI Filter Design\nConducted EMI Characteristics And Mitigation Technique",
			SourceRef: "www.ti.com-snva489c-pdf-c53bd72bcd",
			KBType:    "principle",
		},
		{
			ChunkID:   "generic_power_tpl",
			Score:     0.6890,
			Title:     "tpl-esp32-s3-mcu_power_core.md",
			Snippet:   "Static quality score: 0.86\nIntent tags: power\n10uF bulk capacitor and 100nF decoupling capacitor close to ESP32-S3.",
			SourceRef: "tpl-esp32-s3-mcu_power_core",
			KBType:    "template",
		},
	}

	reranked := rerankGroupedTemplateResults("EMI", results)
	if reranked[0].SourceRef != "www.ti.com-snva489c-pdf-c53bd72bcd" {
		t.Fatalf("expected official EMI knowledge first, got %+v", reranked[0])
	}
}
