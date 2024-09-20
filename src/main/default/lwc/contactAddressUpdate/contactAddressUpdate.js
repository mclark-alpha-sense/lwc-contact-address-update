import { LightningElement, api, wire } from 'lwc'
import { getRelatedListRecords } from 'lightning/uiRelatedListApi'
import { getRecord, updateRecord } from 'lightning/uiRecordApi'
import { ShowToastEvent } from 'lightning/platformShowToastEvent'

const COLS = [
    {
        label: 'Name',
        fieldName: 'ContactUrl',
        type: 'url',
        sortable: true,
        typeAttributes: { label: { fieldName: 'Name' } },
    },
    {
        label: 'Account',
        fieldName: 'AccountUrl',
        type: 'url',
        sortable: true,
        typeAttributes: { label: { fieldName: 'Account__Name' } },
    },
    {
        label: 'Street',
        fieldName: 'MailingStreet',
        editable: true,
        sortable: true,
    },
    {
        label: 'City',
        fieldName: 'MailingCity',
        editable: true,
        sortable: true,
    },
    {
        label: 'State',
        fieldName: 'MailingState',
        editable: true,
        sortable: true,
    },
    {
        label: 'Post Code',
        fieldName: 'MailingPostalCode',
        editable: true,
        sortable: true,
    },
    {
        label: 'Country',
        fieldName: 'MailingCountry',
        editable: true,
        sortable: true,
    },
]

export default class ContactAddressUpdate extends LightningElement {

    @api recordId
    @api objectApiName

    @wire(getRecord, { recordId: '$recordId', fields: ['Opportunity.Type'] })
    record

    get relatedListApiName() {
        switch (this.objectApiName) {
            case 'Opportunity':
                const type = this.record?.data?.fields?.Type?.value
                return type == 'Renewal' ? 'Contacts1__r' : 'Contacts__r'
            default:
                return 'Contacts'
        }
    }

    loading
    error

    contacts = []
    columns = COLS
    selectedRows = []
    errors
    draftValues
    sortedDirection
    sortedBy

    where
    searchIsLoading
    searchDebouncer

    @wire(getRelatedListRecords, {
        parentRecordId: '$recordId',
        relatedListId: '$relatedListApiName',
        fields: ['Contact.Id', 'Contact.Name',
            'Contact.MailingStreet', 'Contact.MailingCity', 'Contact.MailingState', 'Contact.MailingPostalCode', 'Contact.MailingCountry',
            'Contact.Account.Id', 'Contact.Account.Name',
            'Contact.Account.BillingStreet', 'Contact.Account.BillingCity', 'Contact.Account.BillingState', 'Contact.Account.BillingPostalCode', 'Contact.Account.BillingCountry',
        ],
        sortBy: ['Contact.Name'],
        pageSize: 200,
        where: '$where'
    }) getRelatedContacts({ error, data }) {
        if (data) {
            this.contacts = data.records.map(row => {

                // 'collapse' Contact fields
                let contactFlds = {}
                Object.keys(row.fields).forEach(fld => {
                    let val = row.fields[fld].value
                    if (val && fld != 'Account') contactFlds[fld] = val
                })

                // 'collapse' Account fields
                let accountFlds = {}
                Object.keys(row.fields.Account.value.fields).forEach(fld => {
                    let val = row.fields.Account.value.fields[fld].value
                    if (val) accountFlds[`Account__${fld}`] = val
                })

                // Add additional fields
                const ContactUrl = `/${contactFlds.Id}`
                const AccountUrl = `/${accountFlds.Account__Id}`

                return { ...contactFlds, ...accountFlds, ContactUrl, AccountUrl }
            })
            this.error = undefined
            this.sortedBy = 'Name'
            this.sortedDirection = 'asc'
        } else if (error) {
            this.error = JSON.stringify(error)
            this.contacts = undefined
        }
        this.searchIsLoading = false
    }


    handleSuccess(e) {
        // Close the modal window and display a success toast
        this.dispatchEvent(new CloseActionScreenEvent())
        this.dispatchEvent(
            new ShowToastEvent({
                title: 'Success',
                message: 'Selected Contact Addresses Updated!',
                variant: 'success'
            })
        )
    }

    get debug() {
        return false
    }

    get copyDisabled() {
        return !(this.selectedRows?.length > 0)
    }

    handleSearch(event) {
        clearTimeout(this.searchDebouncer)
        const str = event.target?.value
        this.searchDebouncer = setTimeout(() => {            
            console.log(str)
            this.searchIsLoading = true
            this.where = `{ or: [{ Name: { like: \"%${str}%\" }}] }`
    }, 500)
    }

    async handleSelect(event) {
        const {selectedRows} = event.detail
        this.selectedRows = selectedRows.map(row => row.Id)
        // this.draftValues = []
    }

    async handleSort(event) {
        let { fieldName, sortDirection } = event.detail
        this.sortedBy = fieldName
        this.sortedDirection = sortDirection

        if(fieldName == 'ContactUrl') fieldName = 'Name'
        if(fieldName == 'AccountUrl') fieldName = 'Account__Name'
        const sorted = [...this.contacts].sort((a,b) => {
            const dir = (sortDirection == 'asc') ? 1 : -1
            const valA = a[fieldName] || '_'
            const valB = b[fieldName] || '_'
            if (valA > valB) return dir
            if (valA < valB) return -dir
            return 0
        })
        this.contacts = sorted
    }

    handleCancel() {
        this.draftValues = []
        this.selectedRows = []
    }

    async handleSave(event) {
        const { draftValues } = event.detail
        const rowErrors = {}
        this.loading = true
        const successRecords = []
        const failedRecords = []

        await Promise.allSettled(draftValues.map(draftValue => {
            const Id = draftValue.Id

            // validate required fields against existing and draft

            const existing = {...this.contacts.find(x => x.Id == Id)}
            const { MailingStreet, MailingCity, MailingCountry } = {...existing, ...draftValue}

            const title = 'Required fields missing'
            const messages = []
            const fieldNames = []
            if(!MailingStreet || MailingStreet == '') messages.push(`Street is required`) && fieldNames.push('MailingStreet')
            if(!MailingCity || MailingCity == '')  messages.push(`City is required`) && fieldNames.push('MailingCity')
            if(!MailingCountry || MailingCountry == '')  messages.push(`Countryis required`) && fieldNames.push('MailingCountry')

            if (messages.length > 0) {
                rowErrors[Id] = { title, messages, fieldNames }
                failedRecords.push(draftValue)
                return Promise.reject('Required fields missing')
            }

            const fields = { ...draftValue }

            return updateRecord( fields )
            .then(success => {
                successRecords.push(draftValue)
            })
            .catch(error => {
                // add error to datatable errors object
                let fieldErrors = error.body?.output?.fieldErrors || {}
                let fieldNames = []
                let messages = []                
                Object.keys(fieldErrors).forEach( fld => {
                    fieldErrors[fld].forEach(({constituentField, message}) => {
                        fieldNames.push(constituentField)
                        messages.push(message)
                    })
                })
                rowErrors[Id] = {
                    fieldNames: fieldNames,
                    messages: messages,
                    title: 'Error'
                }

                failedRecords.push(draftValue)
            })  
        }))

        if(failedRecords.length > 0) {
            // Report error
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Error',
                    message: `${failedRecords.length} Contacts not updated. See indicated rows for details`,
                    variant: 'error'
                })
            )
        } 

        if(successRecords.length > 0) {
            // Report success
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Success',
                    message: `${successRecords.length} Contacts updated`,
                    variant: 'success'
                })
            )
        }

        this.draftValues = failedRecords
        this.errors = { rows: rowErrors }
        this.loading = false
    }

    // COPY ADDRESS FROM ACCOUNT
    handleCopy() {

        const draftValues = [...this.draftValues || []]
                
        const copied = this.selectedRows.map(Id => {
            // clear selected from draftValues, if needed
            const i = draftValues?.findIndex(x => x.Id == Id)
            if(i > -1) draftValues?.splice(i, 1)

            const c = this.contacts.find(x => x.Id == Id)            
            return {
                Id,
                MailingStreet: c.Account__BillingStreet,
                MailingCity: c.Account__BillingCity,
                MailingState: c.Account__BillingState,
                MailingPostalCode: c.Account__BillingPostalCode,
                MailingCountry: c.Account__BillingCountry,
            }
        })

        // merege copied with remaing draftValues
        this.draftValues = [...draftValues || [], ...copied]
    }

}