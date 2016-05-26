// Copyright (c) 2013, Web Notes Technologies Pvt. Ltd. and Contributors
// License: GNU General Public License v3. See license.txt

cur_frm.cscript.tname = "Sales Invoice Item";
cur_frm.cscript.fname = "entries";
cur_frm.cscript.other_fname = "other_charges";
cur_frm.cscript.sales_team_fname = "sales_team";

// print heading
cur_frm.pformat.print_heading = 'Invoice';

{% include 'digitales/add_artist.js' %};
{% include 'selling/sales_common.js' %};
{% include 'accounts/doctype/sales_taxes_and_charges_master/sales_taxes_and_charges_master.js' %}
{% include 'accounts/doctype/sales_invoice/pos.js' %}

frappe.provide("erpnext.accounts");
erpnext.accounts.SalesInvoiceController = erpnext.selling.SellingController.extend({
	onload: function() {
		this._super();
		this.frm.set_value("ignore_pricing_rule", 0);
		if(!this.frm.doc.__islocal && !this.frm.doc.customer && this.frm.doc.debit_to) {
			// show debit_to in print format
			this.frm.set_df_property("debit_to", "print_hide", 0);
		}

		// toggle to pos view if is_pos is 1 in user_defaults
		if ((is_null(this.frm.doc.is_pos) && cint(frappe.defaults.get_user_default("is_pos"))===1) || this.frm.doc.is_pos) {
			if(this.frm.doc.__islocal && !this.frm.doc.amended_from && !this.frm.doc.customer) {
				this.frm.set_value("is_pos", 1);
				this.is_pos(function() {
					if (cint(frappe.defaults.get_user_defaults("fs_pos_view"))===1)
						cur_frm.cscript.toggle_pos(true);
				});
			}
		}

		// if document is POS then change default print format to "POS Invoice" if no default is specified
		if(cur_frm.doc.is_pos && cur_frm.doc.docstatus===1 && cint(frappe.defaults.get_user_defaults("fs_pos_view"))===1
			&& !locals.DocType[cur_frm.doctype].default_print_format) {
			locals.DocType[cur_frm.doctype].default_print_format = "POS Invoice";
			cur_frm.setup_print_layout();
		}

		/*
			set PO No, Budget and Order Type from Sales Order
			Terms in SINV form to pick ""Net 30"" by default for all SINVs
		*/
		/*if(cur_frm.doc.entries && cur_frm.doc.entries[0].sales_order){
			frappe.model.with_doc('Sales Order', cur_frm.doc.entries[0].sales_order, function() {
				so = frappe.get_doc("Sales Order", cur_frm.doc.entries[0].sales_order);
				cur_frm.doc.po_no = so.po_no;
				cur_frm.doc.new_order_type = so.new_order_type;
				cur_frm.budget = so.budget;
			});
			cur_frm.refresh_field(["po_no","order_type","budget"]);
		}
		set_contract_details(cur_frm.doc.customer);
		cur_frm.refresh_fields();*/
	},

	refresh: function(doc, dt, dn) {
		this._super();

		cur_frm.cscript.is_opening(doc, dt, dn);
		cur_frm.dashboard.reset();

		if(doc.docstatus==1) {
			cur_frm.appframe.add_button('View Ledger', function() {
				frappe.route_options = {
					"voucher_no": doc.name,
					"from_date": doc.posting_date,
					"to_date": doc.posting_date,
					"company": doc.company,
					group_by_voucher: 0
				};
				frappe.set_route("query-report", "General Ledger");
			}, "icon-table");

			var percent_paid = cint(flt(doc.grand_total - doc.outstanding_amount) / flt(doc.grand_total) * 100);
			cur_frm.dashboard.add_progress(percent_paid + "% Paid", percent_paid);

			cur_frm.appframe.add_button(__('Send SMS'), cur_frm.cscript.send_sms, 'icon-mobile-phone');

			if(cint(doc.update_stock)!=1) {
				// show Make Delivery Note button only if Sales Invoice is not created from Delivery Note
				var from_delivery_note = false;
				from_delivery_note = cur_frm.doc.entries
					.some(function(item) {
						return item.delivery_note ? true : false;
					});

				if(!from_delivery_note) {
					cur_frm.appframe.add_primary_action(__('Make Delivery'), cur_frm.cscript['Make Delivery Note'], "icon-truck")
				}
			}

			if(doc.outstanding_amount!=0) {
				cur_frm.appframe.add_primary_action(__('Make Payment Entry'), cur_frm.cscript.make_bank_voucher, "icon-money");
			}
		}

		// Show buttons only when pos view is active
		if (doc.docstatus===0 && !this.pos_active) {
			cur_frm.cscript.sales_order_btn();
			cur_frm.cscript.delivery_note_btn();
			cur_frm.cscript.get_process_btn();
		}
	},

	sales_order_btn: function() {
		this.$sales_order_btn = cur_frm.appframe.add_primary_action(__('From Sales Order'),
			function() {

				frappe.model.map_current_doc({
					method: "erpnext.selling.doctype.sales_order.sales_order.make_sales_invoice",
					source_doctype: "Sales Order",
					get_query_filters: {
						docstatus: 1,
						status: ["!=", "Stopped"],
						per_billed: ["<", 99.99],
						customer: cur_frm.doc.customer || undefined,
						company: cur_frm.doc.company
						//process_status:'Uncompleted'
					}
				})
			}, "icon-download", "btn-default");
	},

	delivery_note_btn: function() {
		this.$delivery_note_btn = cur_frm.appframe.add_primary_action(__('From Delivery Note'),
			function() {
				frappe.model.map_current_doc({
					method: "erpnext.stock.doctype.delivery_note.delivery_note.make_sales_invoice",
					source_doctype: "Delivery Note",
					get_query: function() {
						var filters = {
							company: cur_frm.doc.company
						};
						if(cur_frm.doc.customer) filters["customer"] = cur_frm.doc.customer;
						return {
							query: "erpnext.controllers.queries.get_delivery_notes_to_be_billed",
							filters: filters
						};
					}
				});
			}, "icon-download", "btn-default");
	},

	get_process_btn: function() {
		this.$get_process_btn = cur_frm.appframe.add_primary_action(__('Get Processes'),
			function() {
				if(!cur_frm.doc.customer)
					msgprint("Please Select the Customer first")
				else {
					frappe.model.map_current_doc({
						method: "digitales.digitales.process.make_sales_invoice",
						source_doctype: "Process",
						get_query_filters: {
							docstatus: 1,
							sales_invoice_status: ["=", "Not Done"],
							customer_id: cur_frm.doc.customer
						}
					})
				}
			}, "icon-download", "btn-default");
	},

	tc_name: function() {
		this.get_terms();
	},

	is_pos: function(doc, dt, dn, callback_fn) {
		cur_frm.cscript.hide_fields(this.frm.doc);
		if(cint(this.frm.doc.is_pos)) {
			if(!this.frm.doc.company) {
				this.frm.set_value("is_pos", 0);
				msgprint(__("Please specify Company to proceed"));
			} else {
				var me = this;
				return this.frm.call({
					doc: me.frm.doc,
					method: "set_missing_values",
					callback: function(r) {
						if(!r.exc) {
							me.frm.script_manager.trigger("update_stock");
							frappe.model.set_default_values(me.frm.doc);
							me.set_dynamic_labels();
							me.calculate_taxes_and_totals();
							if(callback_fn) callback_fn();
						}
					}
				});
			}
		}
	},

	customer: function() {
		var me = this;
		if(this.frm.updating_party_details) return;

		erpnext.utils.get_party_details(this.frm,
			"erpnext.accounts.party.get_party_details", {
				posting_date: this.frm.doc.posting_date,
				party: this.frm.doc.customer,
				party_type: "Customer",
				account: this.frm.doc.debit_to,
				price_list: this.frm.doc.selling_price_list,
			}, function() {
			me.apply_pricing_rule();
		})
		// set_contract_details(cur_frm.doc.customer);
	},

	debit_to: function() {
		this.customer();
	},

	allocated_amount: function() {
		this.calculate_total_advance("Sales Invoice", "advance_adjustment_details");
		this.frm.refresh_fields();
	},

	write_off_outstanding_amount_automatically: function() {
		if(cint(this.frm.doc.write_off_outstanding_amount_automatically)) {
			frappe.model.round_floats_in(this.frm.doc, ["grand_total", "paid_amount"]);
			// this will make outstanding amount 0
			this.frm.set_value("write_off_amount",
				flt(this.frm.doc.grand_total - this.frm.doc.paid_amount,
					precision("write_off_amount"))
			);
		}

		this.calculate_outstanding_amount(false);
		this.frm.refresh_fields();
	},

	write_off_amount: function() {
		this.write_off_outstanding_amount_automatically();
	},

	paid_amount: function() {
		this.write_off_outstanding_amount_automatically();
	},

	entries_add: function(doc, cdt, cdn) {
		var row = frappe.get_doc(cdt, cdn);
		this.frm.script_manager.copy_from_first_row("entries", row, ["income_account", "cost_center"]);
	},

	set_dynamic_labels: function() {
		this._super();
		this.hide_fields(this.frm.doc);
	},

	entries_on_form_rendered: function(doc, grid_row) {
		erpnext.setup_serial_no(grid_row)
	}

});

// for backward compatibility: combine new and previous states
$.extend(cur_frm.cscript, new erpnext.accounts.SalesInvoiceController({frm: cur_frm}));

// Hide Fields
// ------------
cur_frm.cscript.hide_fields = function(doc) {
	par_flds = ['project_name', 'due_date', 'is_opening', 'source', 'total_advance', 'gross_profit',
	'gross_profit_percent', 'get_advances_received',
	'advance_adjustment_details', 'sales_partner', 'commission_rate',
	'total_commission', 'advances', 'from_date', 'to_date'];

	item_flds_normal = ['sales_order', 'delivery_note']

	if(cint(doc.is_pos) == 1) {
		hide_field(par_flds);
		unhide_field('payments_section');
		cur_frm.fields_dict['entries'].grid.set_column_disp(item_flds_normal, false);
	} else {
		hide_field('payments_section');
		for (i in par_flds) {
			var docfield = frappe.meta.docfield_map[doc.doctype][par_flds[i]];
			if(!docfield.hidden) unhide_field(par_flds[i]);
		}
		cur_frm.fields_dict['entries'].grid.set_column_disp(item_flds_normal, true);
	}

	item_flds_stock = ['serial_no', 'batch_no', 'actual_qty', 'expense_account', 'warehouse']
	cur_frm.fields_dict['entries'].grid.set_column_disp(item_flds_stock,
		(cint(doc.update_stock)==1 ? true : false));

	// India related fields
	if (frappe.boot.sysdefaults.country == 'India') unhide_field(['c_form_applicable', 'c_form_no']);
	else hide_field(['c_form_applicable', 'c_form_no']);

	cur_frm.refresh_fields();
}


cur_frm.cscript.mode_of_payment = function(doc) {
	return cur_frm.call({
		method: "erpnext.accounts.doctype.sales_invoice.sales_invoice.get_bank_cash_account",
		args: { mode_of_payment: doc.mode_of_payment },
	});
}

cur_frm.cscript.update_stock = function(doc, dt, dn) {
	cur_frm.cscript.hide_fields(doc, dt, dn);
}

cur_frm.cscript.is_opening = function(doc, dt, dn) {
	hide_field('aging_date');
	if (doc.is_opening == 'Yes') unhide_field('aging_date');
}

cur_frm.cscript['Make Delivery Note'] = function() {
	frappe.model.open_mapped_doc({
		method: "erpnext.accounts.doctype.sales_invoice.sales_invoice.make_delivery_note",
		frm: cur_frm
	})
}

cur_frm.cscript.make_bank_voucher = function() {
	return frappe.call({
		method: "erpnext.accounts.doctype.journal_voucher.journal_voucher.get_payment_entry_from_sales_invoice",
		args: {
			"sales_invoice": cur_frm.doc.name
		},
		callback: function(r) {
			var doclist = frappe.model.sync(r.message);
			frappe.set_route("Form", doclist[0].doctype, doclist[0].name);
		}
	});
}

cur_frm.fields_dict.debit_to.get_query = function(doc) {
	return{
		filters: {
			'report_type': 'Balance Sheet',
			'group_or_ledger': 'Ledger',
			'company': doc.company
		}
	}
}

cur_frm.fields_dict.cash_bank_account.get_query = function(doc) {
	return{
		filters: {
			'report_type': 'Balance Sheet',
			'group_or_ledger': 'Ledger',
			'company': doc.company
		}
	}
}

cur_frm.fields_dict.write_off_account.get_query = function(doc) {
	return{
		filters:{
			'report_type': 'Profit and Loss',
			'group_or_ledger': 'Ledger',
			'company': doc.company
		}
	}
}

// Write off cost center
//-----------------------
cur_frm.fields_dict.write_off_cost_center.get_query = function(doc) {
	return{
		filters:{
			'group_or_ledger': 'Ledger',
			'company': doc.company
		}
	}
}

//project name
//--------------------------
cur_frm.fields_dict['project_name'].get_query = function(doc, cdt, cdn) {
	return{
		query: "erpnext.controllers.queries.get_project_name",
		filters: {'customer': doc.customer}
	}
}

// Income Account in Details Table
// --------------------------------
cur_frm.set_query("income_account", "entries", function(doc) {
	return{
		query: "erpnext.accounts.doctype.sales_invoice.sales_invoice.get_income_account",
		filters: {'company': doc.company}
	}
});

// expense account
if (sys_defaults.auto_accounting_for_stock) {
	cur_frm.fields_dict['entries'].grid.get_field('expense_account').get_query = function(doc) {
		return {
			filters: {
				'report_type': 'Profit and Loss',
				'company': doc.company,
				'group_or_ledger': 'Ledger'
			}
		}
	}
}


// Cost Center in Details Table
// -----------------------------
cur_frm.fields_dict["entries"].grid.get_field("cost_center").get_query = function(doc) {
	return {
		filters: {
			'company': doc.company,
			'group_or_ledger': 'Ledger'
		}
	}
}

cur_frm.cscript.income_account = function(doc, cdt, cdn) {
	cur_frm.cscript.copy_account_in_all_row(doc, cdt, cdn, "income_account");
}

cur_frm.cscript.expense_account = function(doc, cdt, cdn) {
	cur_frm.cscript.copy_account_in_all_row(doc, cdt, cdn, "expense_account");
}

cur_frm.cscript.cost_center = function(doc, cdt, cdn) {
	cur_frm.cscript.copy_account_in_all_row(doc, cdt, cdn, "cost_center");
}

cur_frm.cscript.on_submit = function(doc, cdt, cdn) {
	if(cint(frappe.boot.notification_settings.sales_invoice)) {
		cur_frm.email_doc(frappe.boot.notification_settings.sales_invoice_message);
	}

	$.each(doc["entries"], function(i, row) {
		if(row.delivery_note) frappe.model.clear_doc("Delivery Note", row.delivery_note)
	})
}

cur_frm.cscript.send_sms = function() {
	frappe.require("assets/erpnext/js/sms_manager.js");
	var sms_man = new SMSManager(cur_frm.doc);
}

cur_frm.get_field("budget").get_query=function(doc,cdt,cdn){
	if (doc.customer){
 		{
    		return "select budget from `tabBudget Details` where parent='"+doc.customer+"'"

 		}
 	}
 	else
 		msgprint("First select the customer")
}

cur_frm.cscript.sales_person = function(doc,cdt, cdn){
	d = locals[cdt][cdn].allocated_percentage = 100;
	cur_frm.refresh_field("sales_team");
}

/*set_contract_details = function(customer){
	// set the tender group and contract number from customer contract details
	if(customer){
		return frappe.call({
			method: "erpnext.selling.doctype.customer.customer.get_contract_details",
			args: {
				"customer": customer
			},
			callback: function(r) {
				if(r.message){
					cur_frm.doc.contract_number = r.message.contract_no;
					cur_frm.doc.tender_group = r.message.tender_group;
					cur_frm.refresh_fields();
				}
			}
		});
	}
}*/